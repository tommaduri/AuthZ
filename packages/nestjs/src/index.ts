// Module
export { AuthzModule, AUTHZ_CLIENT, AUTHZ_OPTIONS, AUTHZ_AGENTIC_SERVICE } from './authz.module';
export type { AuthzModuleOptions, AuthzModuleAsyncOptions, AuthzOptionsFactory } from './authz.module';

// Service - Standard
export { AuthzService } from './authz.service';
export type {
  AgenticCheckOptions as ServiceAgenticCheckOptions,
  AgenticCheckResult,
  AgentHealth,
  Anomaly,
  PatternDiscoveryResult,
  EnforcementAction,
  QuestionResult,
} from './authz.service';

// Service - Agentic
export { AuthzAgenticService, AUTHZ_AGENTIC_CONFIG } from './authz-agentic.service';
export type {
  AuthzAgenticConfig,
  AgenticProcessingOutput,
} from './authz-agentic.service';

// Guard
export { AuthzGuard } from './authz.guard';

// Decorators - Standard
export {
  Authorize,
  AuthorizeResource,
  AuthorizeAvatar,
  AuthorizeSubscription,
  AuthorizeChat,
  AuthorizePayout,
  AuthorizeNotification,
  RequireRole,
  Public,
  AUTHZ_METADATA_KEY,
  ROLES_METADATA_KEY,
  IS_PUBLIC_KEY,
} from './decorators';

// Decorators - Agentic (Legacy)
export {
  AuthorizeWithExplanation,
  AnomalyProtected,
  AuditAction,
  AuthzExplanation,
  AnomalyScore,
  AuthzFactors,
  AuthzConfidence,
  AUTHZ_EXPLANATION_KEY,
  ANOMALY_PROTECTED_KEY,
  AUDIT_ACTION_KEY,
} from './decorators';

// Decorators - Agentic Pipeline (New)
export {
  AgenticCheck,
  RequireAnalysis,
  WithRecommendations,
  RateLimited,
  ThreatProtected,
  AGENTIC_CHECK_KEY,
  REQUIRE_ANALYSIS_KEY,
  WITH_RECOMMENDATIONS_KEY,
  RATE_LIMITED_KEY,
  THREAT_PROTECTED_KEY,
} from './decorators';

// Parameter Decorators - Agentic Pipeline (New)
export {
  Recommendations,
  AnalysisResult,
  ThreatInfo,
  RateLimitInfo,
  AgenticResult,
} from './decorators';

// Types - Decorators (Standard)
export type {
  AuthzMetadata,
  AgenticAuthzMetadata,
  AnomalyProtectionOptions,
  AuditActionOptions,
  AuthzFactor,
} from './decorators';

// Types - Decorators (Agentic Pipeline)
export type {
  AgenticCheckOptions,
  RequireAnalysisOptions,
  WithRecommendationsOptions,
  RateLimitedOptions,
  ThreatProtectedOptions,
  AgenticDecoratorMetadata,
  AnalysisData,
  ThreatData,
  RateLimitData,
  AgenticProcessingResult,
} from './decorators';

// Re-export SDK types
export type {
  Principal,
  Resource,
  CheckResult,
  AuthzClientConfig,
} from '@authz-engine/sdk';
