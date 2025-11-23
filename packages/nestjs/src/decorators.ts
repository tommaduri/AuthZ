import { SetMetadata, applyDecorators, UseGuards, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthzGuard } from './authz.guard';

export const AUTHZ_METADATA_KEY = 'authz:metadata';
export const AUTHZ_EXPLANATION_KEY = 'authz:explanation';
export const ANOMALY_PROTECTED_KEY = 'authz:anomaly_protected';
export const AUDIT_ACTION_KEY = 'authz:audit_action';

/**
 * Authorization metadata stored on handler
 */
export interface AuthzMetadata {
  /** Resource type (e.g., 'subscription', 'avatar', 'chat') */
  resource: string;
  /** Action to check (e.g., 'create', 'read', 'update', 'delete') */
  action: string;
  /** Parameter name for resource ID (default: 'id') */
  resourceIdParam?: string;
  /** Whether to include request body as resource attributes */
  resourceFromBody?: boolean;
}

/**
 * Extended metadata for agentic authorization
 */
export interface AgenticAuthzMetadata extends AuthzMetadata {
  /** Include explanation in response */
  includeExplanation?: boolean;
  /** Check for anomalies */
  checkAnomalies?: boolean;
  /** Log action for analyst learning */
  auditAction?: boolean;
  /** Additional context for agents */
  context?: Record<string, unknown>;
}

/**
 * Anomaly protection options
 */
export interface AnomalyProtectionOptions {
  /** Maximum anomaly score allowed (0-1). Requests above this threshold will be blocked. */
  maxAnomalyScore?: number;
  /** Whether to log high anomaly requests */
  logHighAnomaly?: boolean;
  /** Custom action to take when anomaly detected */
  onAnomaly?: 'block' | 'warn' | 'log';
}

/**
 * Audit action options
 */
export interface AuditActionOptions {
  /** Custom action name for audit log */
  actionName?: string;
  /** Include request body in audit */
  includeBody?: boolean;
  /** Include response in audit */
  includeResponse?: boolean;
  /** Custom metadata to include */
  metadata?: Record<string, unknown>;
}

/**
 * @Authorize decorator
 *
 * Marks a handler as requiring authorization.
 * Use with AuthzGuard to automatically check permissions.
 *
 * @example
 * ```typescript
 * @Authorize({ resource: 'subscription', action: 'create' })
 * @Post()
 * async createSubscription() { ... }
 * ```
 *
 * @example
 * ```typescript
 * @Authorize({ resource: 'avatar', action: 'update', resourceIdParam: 'avatarId' })
 * @Put(':avatarId')
 * async updateAvatar(@Param('avatarId') id: string) { ... }
 * ```
 */
export function Authorize(metadata: AuthzMetadata) {
  return applyDecorators(
    SetMetadata(AUTHZ_METADATA_KEY, metadata),
    UseGuards(AuthzGuard),
  );
}

/**
 * @AuthorizeResource decorator factory
 *
 * Creates a resource-specific authorize decorator.
 *
 * @example
 * ```typescript
 * const AuthorizeSubscription = AuthorizeResource('subscription');
 *
 * @AuthorizeSubscription('create')
 * @Post()
 * async createSubscription() { ... }
 * ```
 */
export function AuthorizeResource(resource: string) {
  return (action: string, options?: Omit<AuthzMetadata, 'resource' | 'action'>) => {
    return Authorize({ resource, action, ...options });
  };
}

/**
 * Pre-built decorators for common Avatar Connex resources
 */
export const AuthorizeAvatar = AuthorizeResource('avatar');
export const AuthorizeSubscription = AuthorizeResource('subscription');
export const AuthorizeChat = AuthorizeResource('chat');
export const AuthorizePayout = AuthorizeResource('payout');
export const AuthorizeNotification = AuthorizeResource('notification');

/**
 * @RequireRole decorator
 *
 * Simple role-based authorization (without calling AuthZ Engine).
 * Use for basic role checks that don't need complex policy evaluation.
 *
 * @example
 * ```typescript
 * @RequireRole('admin')
 * @Get('admin/dashboard')
 * async adminDashboard() { ... }
 * ```
 */
export const ROLES_METADATA_KEY = 'authz:roles';

export function RequireRole(...roles: string[]) {
  return SetMetadata(ROLES_METADATA_KEY, roles);
}

/**
 * @Public decorator
 *
 * Marks a handler as public (no authorization required).
 * Useful when applying guards globally.
 */
export const IS_PUBLIC_KEY = 'authz:public';

export function Public() {
  return SetMetadata(IS_PUBLIC_KEY, true);
}

// ============================================
// AGENTIC AUTHORIZATION DECORATORS
// ============================================

/**
 * @AuthorizeWithExplanation decorator
 *
 * Like @Authorize but uses agentic authorization with full explanation.
 * The explanation and other agentic data will be available in the request context.
 *
 * @example
 * ```typescript
 * @AuthorizeWithExplanation({ resource: 'subscription', action: 'cancel' })
 * @Post(':id/cancel')
 * async cancelSubscription(@Param('id') id: string, @AuthzExplanation() explanation: string) {
 *   // explanation contains the reason for the authorization decision
 * }
 * ```
 */
export function AuthorizeWithExplanation(metadata: AgenticAuthzMetadata) {
  return applyDecorators(
    SetMetadata(AUTHZ_METADATA_KEY, {
      ...metadata,
      includeExplanation: true,
      checkAnomalies: metadata.checkAnomalies ?? true,
      auditAction: metadata.auditAction ?? false,
    }),
    SetMetadata(AUTHZ_EXPLANATION_KEY, true),
    UseGuards(AuthzGuard),
  );
}

/**
 * @AnomalyProtected decorator
 *
 * Adds anomaly detection middleware to the handler.
 * Requests with high anomaly scores can be blocked or logged.
 *
 * @example
 * ```typescript
 * @AnomalyProtected({ maxAnomalyScore: 0.7, onAnomaly: 'block' })
 * @Authorize({ resource: 'payment', action: 'create' })
 * @Post('payment')
 * async createPayment() { ... }
 * ```
 */
export function AnomalyProtected(options: AnomalyProtectionOptions = {}) {
  const { maxAnomalyScore = 0.8, logHighAnomaly = true, onAnomaly = 'block' } = options;
  return applyDecorators(
    SetMetadata(ANOMALY_PROTECTED_KEY, {
      enabled: true,
      maxAnomalyScore,
      logHighAnomaly,
      onAnomaly,
    }),
  );
}

/**
 * @AuditAction decorator
 *
 * Logs the action for analyst learning.
 * Use on sensitive operations that should be tracked for pattern analysis.
 *
 * @example
 * ```typescript
 * @AuditAction({ actionName: 'user_data_export', includeBody: false })
 * @Authorize({ resource: 'user', action: 'export' })
 * @Post('users/:id/export')
 * async exportUserData(@Param('id') id: string) { ... }
 * ```
 */
export function AuditAction(options: AuditActionOptions = {}) {
  return applyDecorators(
    SetMetadata(AUDIT_ACTION_KEY, {
      enabled: true,
      ...options,
    }),
  );
}

/**
 * @AuthzExplanation parameter decorator
 *
 * Extracts the authorization explanation from the request context.
 * Use with @AuthorizeWithExplanation.
 *
 * @example
 * ```typescript
 * @AuthorizeWithExplanation({ resource: 'document', action: 'delete' })
 * @Delete(':id')
 * async deleteDocument(@Param('id') id: string, @AuthzExplanation() explanation: string) {
 *   console.log(`Deletion authorized: ${explanation}`);
 * }
 * ```
 */
export const AuthzExplanation = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.authzExplanation;
  },
);

/**
 * @AnomalyScore parameter decorator
 *
 * Extracts the anomaly score from the request context.
 * Use with @AnomalyProtected or @AuthorizeWithExplanation.
 *
 * @example
 * ```typescript
 * @AnomalyProtected()
 * @Authorize({ resource: 'transfer', action: 'create' })
 * @Post('transfer')
 * async createTransfer(@AnomalyScore() score: number) {
 *   if (score > 0.5) {
 *     // Require additional verification
 *   }
 * }
 * ```
 */
export const AnomalyScore = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.authzAnomalyScore;
  },
);

/**
 * @AuthzFactors parameter decorator
 *
 * Extracts the authorization factors from the request context.
 * Use with @AuthorizeWithExplanation.
 *
 * @example
 * ```typescript
 * @AuthorizeWithExplanation({ resource: 'report', action: 'view' })
 * @Get(':id')
 * async viewReport(@Param('id') id: string, @AuthzFactors() factors: AuthzFactor[]) {
 *   // factors contains the decision factors
 * }
 * ```
 */
export const AuthzFactors = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Array<{ factor: string; impact: string; weight: number }> | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.authzFactors;
  },
);

/**
 * @AuthzConfidence parameter decorator
 *
 * Extracts the authorization confidence score from the request context.
 * Use with @AuthorizeWithExplanation.
 *
 * @example
 * ```typescript
 * @AuthorizeWithExplanation({ resource: 'action', action: 'perform' })
 * @Post('action')
 * async performAction(@AuthzConfidence() confidence: number) {
 *   if (confidence < 0.9) {
 *     // Log for review
 *   }
 * }
 * ```
 */
export const AuthzConfidence = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.authzConfidence;
  },
);

/**
 * Helper type for authorization factors
 */
export interface AuthzFactor {
  factor: string;
  impact: 'positive' | 'negative' | 'neutral';
  weight: number;
}
