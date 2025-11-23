/**
 * AuthZ Engine gRPC Client
 *
 * TypeScript client for connecting to the AuthZ Engine Go core via gRPC.
 *
 * @example
 * ```typescript
 * import { createClient, Effect } from '@authz-engine/grpc-client';
 *
 * const client = createClient({
 *   address: 'localhost:50051',
 *   timeout: 5000,
 * });
 *
 * await client.connect();
 *
 * const response = await client.check({
 *   requestId: 'req-1',
 *   principal: {
 *     id: 'user-123',
 *     roles: ['admin'],
 *   },
 *   resource: {
 *     kind: 'document',
 *     id: 'doc-456',
 *   },
 *   actions: ['read', 'write'],
 * });
 *
 * if (response.results.get('read')?.effect === Effect.ALLOW) {
 *   console.log('Read access granted!');
 * }
 *
 * client.disconnect();
 * ```
 */

export { AuthzClient, createClient } from './client.js';

export {
  Effect,
  type Principal,
  type Resource,
  type CheckRequest,
  type CheckResponse,
  type CheckBatchRequest,
  type CheckBatchResponse,
  type ActionResult,
  type ResponseMetadata,
  type ClientOptions,
  type ClientStats,
  type StreamCallback,
  type StreamErrorCallback,
  type StreamEndCallback,
  DEFAULT_OPTIONS,
} from './types.js';

/**
 * Helper function to check if an action is allowed
 */
export function isAllowed(
  response: import('./types.js').CheckResponse,
  action: string
): boolean {
  const result = response.results.get(action);
  return result?.effect === import('./types.js').Effect.ALLOW;
}

/**
 * Helper function to check if an action is denied
 */
export function isDenied(
  response: import('./types.js').CheckResponse,
  action: string
): boolean {
  const result = response.results.get(action);
  return result?.effect === import('./types.js').Effect.DENY;
}

/**
 * Helper function to get all allowed actions from a response
 */
export function getAllowedActions(
  response: import('./types.js').CheckResponse
): string[] {
  const allowed: string[] = [];
  for (const [action, result] of response.results) {
    if (result.effect === import('./types.js').Effect.ALLOW) {
      allowed.push(action);
    }
  }
  return allowed;
}

/**
 * Helper function to get all denied actions from a response
 */
export function getDeniedActions(
  response: import('./types.js').CheckResponse
): string[] {
  const denied: string[] = [];
  for (const [action, result] of response.results) {
    if (result.effect === import('./types.js').Effect.DENY) {
      denied.push(action);
    }
  }
  return denied;
}
