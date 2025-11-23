export { AuthzClient, AuthzError, createClient } from './client';
export type { AuthzClientConfig, CheckOptions, CheckResult } from './client';

// Re-export core types for convenience
export type {
  Principal,
  Resource,
  Effect,
  CheckRequest,
  CheckResponse,
} from '@authz-engine/core';
