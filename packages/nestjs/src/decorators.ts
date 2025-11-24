import { SetMetadata, applyDecorators, UseGuards, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthzGuard } from './authz.guard';

// Constants for default values
const DEFAULT_ANOMALY_THRESHOLD = 0.8;
const DEFAULT_MIN_CONFIDENCE = 0.7;
const DEFAULT_MAX_RECOMMENDATIONS = 5;

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
  const { maxAnomalyScore = DEFAULT_ANOMALY_THRESHOLD, logHighAnomaly = true, onAnomaly = 'block' } = options;
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

// ============================================
// NEW AGENTIC PIPELINE DECORATORS
// ============================================

export const AGENTIC_CHECK_KEY = 'authz:agentic_check';
export const REQUIRE_ANALYSIS_KEY = 'authz:require_analysis';
export const WITH_RECOMMENDATIONS_KEY = 'authz:with_recommendations';
export const RATE_LIMITED_KEY = 'authz:rate_limited';
export const THREAT_PROTECTED_KEY = 'authz:threat_protected';

/**
 * Full agentic pipeline check options
 */
export interface AgenticCheckOptions {
  /** Resource type */
  resource: string;
  /** Action to check */
  action: string;
  /** Include ANALYST analysis */
  includeAnalysis?: boolean;
  /** Include ADVISOR recommendations */
  includeRecommendations?: boolean;
  /** Enable GUARDIAN threat detection */
  enableThreatDetection?: boolean;
  /** Enable ENFORCER rate limiting */
  enableRateLimiting?: boolean;
  /** Custom context for agents */
  context?: Record<string, unknown>;
  /** Priority level for processing */
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Analysis options for ANALYST agent
 */
export interface RequireAnalysisOptions {
  /** Minimum confidence score required (0-1) */
  minConfidence?: number;
  /** Include pattern matching */
  includePatterns?: boolean;
  /** Include historical analysis */
  includeHistory?: boolean;
  /** Custom analysis context */
  context?: Record<string, unknown>;
}

/**
 * Recommendation options for ADVISOR agent
 */
export interface WithRecommendationsOptions {
  /** Include policy suggestions */
  includePolicySuggestions?: boolean;
  /** Include path to allow (if denied) */
  includePathToAllow?: boolean;
  /** Max number of recommendations */
  maxRecommendations?: number;
  /** Enable natural language explanations */
  enableNaturalLanguage?: boolean;
}

/**
 * Rate limiting options for ENFORCER agent
 */
export interface RateLimitedOptions {
  /** Max requests per window */
  maxRequests: number;
  /** Window size in seconds */
  windowSeconds: number;
  /** Custom key extractor (e.g., 'user.id', 'ip') */
  keyBy?: 'principal' | 'ip' | 'resource' | string;
  /** Action on limit exceeded */
  onLimitExceeded?: 'block' | 'throttle' | 'warn';
  /** Skip rate limiting for certain roles */
  skipForRoles?: string[];
}

/**
 * Threat protection options for GUARDIAN agent
 */
export interface ThreatProtectedOptions {
  /** Anomaly score threshold (0-1) */
  anomalyThreshold?: number;
  /** Types of threats to check */
  threatTypes?: Array<
    | 'unusual_access_time'
    | 'unusual_resource_access'
    | 'permission_escalation'
    | 'velocity_spike'
    | 'geographic_anomaly'
    | 'pattern_deviation'
  >;
  /** Action on threat detected */
  onThreatDetected?: 'block' | 'alert' | 'log' | 'require_mfa';
  /** Require additional verification above threshold */
  requireVerificationAbove?: number;
}

/**
 * Metadata stored by agentic decorators
 */
export interface AgenticDecoratorMetadata {
  agenticCheck?: AgenticCheckOptions & { enabled: true };
  requireAnalysis?: RequireAnalysisOptions & { enabled: true };
  withRecommendations?: WithRecommendationsOptions & { enabled: true };
  rateLimited?: RateLimitedOptions & { enabled: true };
  threatProtected?: ThreatProtectedOptions & { enabled: true };
}

/**
 * @AgenticCheck decorator
 *
 * Full agentic pipeline authorization check.
 * Runs request through all 4 agents:
 * - GUARDIAN: Threat detection
 * - ANALYST: Pattern analysis
 * - ADVISOR: Recommendations
 * - ENFORCER: Rate limiting and enforcement
 *
 * @example
 * ```typescript
 * @AgenticCheck({
 *   resource: 'payment',
 *   action: 'create',
 *   enableThreatDetection: true,
 *   includeRecommendations: true,
 * })
 * @Post('payments')
 * async createPayment() { ... }
 * ```
 */
export function AgenticCheck(options: AgenticCheckOptions) {
  return applyDecorators(
    SetMetadata(AGENTIC_CHECK_KEY, {
      ...options,
      enabled: true,
      includeAnalysis: options.includeAnalysis ?? true,
      includeRecommendations: options.includeRecommendations ?? false,
      enableThreatDetection: options.enableThreatDetection ?? true,
      enableRateLimiting: options.enableRateLimiting ?? false,
      priority: options.priority ?? 'medium',
    }),
    SetMetadata(AUTHZ_METADATA_KEY, {
      resource: options.resource,
      action: options.action,
    }),
    UseGuards(AuthzGuard),
  );
}

/**
 * @RequireAnalysis decorator
 *
 * Require ANALYST agent analysis before authorization decision.
 * Use when you need pattern matching and historical context.
 *
 * @example
 * ```typescript
 * @RequireAnalysis({ minConfidence: 0.8, includePatterns: true })
 * @Authorize({ resource: 'report', action: 'generate' })
 * @Post('reports')
 * async generateReport() { ... }
 * ```
 */
export function RequireAnalysis(options: RequireAnalysisOptions = {}) {
  return applyDecorators(
    SetMetadata(REQUIRE_ANALYSIS_KEY, {
      enabled: true,
      minConfidence: options.minConfidence ?? DEFAULT_MIN_CONFIDENCE,
      includePatterns: options.includePatterns ?? true,
      includeHistory: options.includeHistory ?? true,
      context: options.context ?? {},
    }),
  );
}

/**
 * @WithRecommendations decorator
 *
 * Include ADVISOR agent recommendations in the response.
 * Provides actionable suggestions and explanations.
 *
 * @example
 * ```typescript
 * @WithRecommendations({ includePolicySuggestions: true })
 * @Authorize({ resource: 'config', action: 'update' })
 * @Put('config')
 * async updateConfig(@Recommendations() recs: string[]) { ... }
 * ```
 */
export function WithRecommendations(options: WithRecommendationsOptions = {}) {
  return applyDecorators(
    SetMetadata(WITH_RECOMMENDATIONS_KEY, {
      enabled: true,
      includePolicySuggestions: options.includePolicySuggestions ?? false,
      includePathToAllow: options.includePathToAllow ?? true,
      maxRecommendations: options.maxRecommendations ?? DEFAULT_MAX_RECOMMENDATIONS,
      enableNaturalLanguage: options.enableNaturalLanguage ?? true,
    }),
  );
}

/**
 * @RateLimited decorator
 *
 * Apply ENFORCER rate limiting to the endpoint.
 * Protects against abuse and ensures fair usage.
 *
 * @example
 * ```typescript
 * @RateLimited({ maxRequests: 100, windowSeconds: 60, keyBy: 'principal' })
 * @Authorize({ resource: 'api', action: 'call' })
 * @Post('api/data')
 * async getData() { ... }
 * ```
 */
export function RateLimited(options: RateLimitedOptions) {
  return applyDecorators(
    SetMetadata(RATE_LIMITED_KEY, {
      enabled: true,
      maxRequests: options.maxRequests,
      windowSeconds: options.windowSeconds,
      keyBy: options.keyBy ?? 'principal',
      onLimitExceeded: options.onLimitExceeded ?? 'block',
      skipForRoles: options.skipForRoles ?? [],
    }),
  );
}

/**
 * @ThreatProtected decorator
 *
 * Enable GUARDIAN threat detection for the endpoint.
 * Detects and responds to anomalous access patterns.
 *
 * @example
 * ```typescript
 * @ThreatProtected({
 *   anomalyThreshold: 0.7,
 *   threatTypes: ['permission_escalation', 'velocity_spike'],
 *   onThreatDetected: 'block',
 * })
 * @Authorize({ resource: 'admin', action: 'access' })
 * @Get('admin/dashboard')
 * async adminDashboard() { ... }
 * ```
 */
export function ThreatProtected(options: ThreatProtectedOptions = {}) {
  return applyDecorators(
    SetMetadata(THREAT_PROTECTED_KEY, {
      enabled: true,
      anomalyThreshold: options.anomalyThreshold ?? DEFAULT_ANOMALY_THRESHOLD,
      threatTypes: options.threatTypes ?? [
        'permission_escalation',
        'velocity_spike',
        'unusual_resource_access',
      ],
      onThreatDetected: options.onThreatDetected ?? 'block',
      requireVerificationAbove: options.requireVerificationAbove,
    }),
  );
}

// ============================================
// NEW PARAMETER DECORATORS
// ============================================

/**
 * @Recommendations parameter decorator
 *
 * Extracts ADVISOR recommendations from the request context.
 * Use with @WithRecommendations.
 *
 * @example
 * ```typescript
 * @WithRecommendations()
 * @Authorize({ resource: 'policy', action: 'create' })
 * @Post('policies')
 * async createPolicy(@Recommendations() recommendations: string[]) {
 *   // recommendations contains actionable suggestions
 * }
 * ```
 */
export const Recommendations = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string[] | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.authzRecommendations;
  },
);

/**
 * @AnalysisResult parameter decorator
 *
 * Extracts ANALYST analysis from the request context.
 * Use with @RequireAnalysis.
 *
 * @example
 * ```typescript
 * @RequireAnalysis()
 * @Authorize({ resource: 'data', action: 'export' })
 * @Post('export')
 * async exportData(@AnalysisResult() analysis: AnalysisData) {
 *   // analysis contains patterns and historical context
 * }
 * ```
 */
export const AnalysisResult = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AnalysisData | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.authzAnalysis;
  },
);

/**
 * @ThreatInfo parameter decorator
 *
 * Extracts GUARDIAN threat information from the request context.
 * Use with @ThreatProtected.
 *
 * @example
 * ```typescript
 * @ThreatProtected()
 * @Authorize({ resource: 'secure', action: 'access' })
 * @Get('secure')
 * async secureEndpoint(@ThreatInfo() threat: ThreatData) {
 *   if (threat.anomalyScore > 0.5) {
 *     // Log suspicious activity
 *   }
 * }
 * ```
 */
export const ThreatInfo = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ThreatData | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.authzThreatInfo;
  },
);

/**
 * @RateLimitInfo parameter decorator
 *
 * Extracts ENFORCER rate limit information from the request context.
 * Use with @RateLimited.
 *
 * @example
 * ```typescript
 * @RateLimited({ maxRequests: 100, windowSeconds: 60 })
 * @Authorize({ resource: 'api', action: 'call' })
 * @Post('api')
 * async apiCall(@RateLimitInfo() rateLimit: RateLimitData) {
 *   // rateLimit contains remaining requests and reset time
 * }
 * ```
 */
export const RateLimitInfo = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RateLimitData | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.authzRateLimitInfo;
  },
);

/**
 * @AgenticResult parameter decorator
 *
 * Extracts the full agentic processing result from the request context.
 * Use with @AgenticCheck for complete pipeline results.
 *
 * @example
 * ```typescript
 * @AgenticCheck({ resource: 'payment', action: 'create' })
 * @Post('payments')
 * async createPayment(@AgenticResult() result: AgenticProcessingResult) {
 *   console.log(`Processed by: ${result.agentsInvolved.join(', ')}`);
 * }
 * ```
 */
export const AgenticResult = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AgenticProcessingResult | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.authzAgenticResult;
  },
);

// ============================================
// SUPPORTING TYPES
// ============================================

/**
 * Analysis data from ANALYST agent
 */
export interface AnalysisData {
  confidence: number;
  patterns: Array<{
    id: string;
    name: string;
    confidence: number;
    description: string;
  }>;
  historicalContext: {
    similarDecisions: number;
    avgConfidence: number;
    commonOutcomes: string[];
  };
  riskAssessment: {
    level: 'low' | 'medium' | 'high';
    factors: string[];
  };
}

/**
 * Threat data from GUARDIAN agent
 */
export interface ThreatData {
  anomalyScore: number;
  isAnomalous: boolean;
  detectedThreats: Array<{
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
  }>;
  riskFactors: Array<{
    factor: string;
    score: number;
  }>;
  baseline: {
    avgRequestsPerHour: number;
    deviation: number;
  };
}

/**
 * Rate limit data from ENFORCER agent
 */
export interface RateLimitData {
  remaining: number;
  limit: number;
  resetAt: Date;
  isLimited: boolean;
  currentUsage: number;
}

/**
 * Full agentic processing result
 */
export interface AgenticProcessingResult {
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
}
