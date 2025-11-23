// Module
export { AuthzModule, AUTHZ_CLIENT, AUTHZ_OPTIONS } from './authz.module';
export type { AuthzModuleOptions, AuthzModuleAsyncOptions } from './authz.module';

// Service
export { AuthzService } from './authz.service';
export type {
  AgenticCheckOptions,
  AgenticCheckResult,
  AgentHealth,
  Anomaly,
  PatternDiscoveryResult,
  EnforcementAction,
  QuestionResult,
} from './authz.service';

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

// Decorators - Agentic
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

// Types - Decorators
export type {
  AuthzMetadata,
  AgenticAuthzMetadata,
  AnomalyProtectionOptions,
  AuditActionOptions,
  AuthzFactor,
} from './decorators';

// Re-export SDK types
export type {
  Principal,
  Resource,
  CheckResult,
  AuthzClientConfig,
} from '@authz-engine/sdk';
