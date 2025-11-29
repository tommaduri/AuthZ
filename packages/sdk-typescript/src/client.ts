import type {
  CheckRequest,
  CheckResponse,
  Principal,
  Resource,
  Effect,
} from '@authz-engine/core';

// =============================================================================
// Constants
// =============================================================================

/** Default request timeout in milliseconds */
const DEFAULT_TIMEOUT_MS = 5000;

/** Default maximum retry attempts */
const DEFAULT_MAX_RETRIES = 3;

/** Default backoff delay in milliseconds */
const DEFAULT_BACKOFF_MS = 100;

/** Exponential backoff base multiplier */
const EXPONENTIAL_BACKOFF_BASE = 2;

/** Client error status code range start */
const CLIENT_ERROR_MIN = 400;

/** Client error status code range end */
const CLIENT_ERROR_MAX = 500;

/**
 * SDK Configuration
 */
export interface AuthzClientConfig {
  /** Server URL (REST endpoint) */
  serverUrl: string;
  /** Optional gRPC URL for high-performance mode */
  grpcUrl?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Custom headers to include in requests */
  headers?: Record<string, string>;
  /** Retry configuration */
  retry?: {
    maxRetries: number;
    backoffMs: number;
  };
}

/**
 * Check options for a single request
 */
export interface CheckOptions {
  /** Additional auxiliary data */
  auxData?: Record<string, unknown>;
  /** Request timeout override */
  timeout?: number;
}

/**
 * Simplified check result
 */
export interface CheckResult {
  /** Whether the action is allowed */
  allowed: boolean;
  /** Detailed results for each action */
  results: Record<string, {
    effect: Effect;
    policy: string;
  }>;
  /** Request ID for tracing */
  requestId: string;
}

/**
 * AuthZ Engine Client
 *
 * TypeScript SDK for interacting with the AuthZ Engine server.
 */
export class AuthzClient {
  private config: Required<AuthzClientConfig>;

  constructor(config: AuthzClientConfig) {
    this.config = {
      serverUrl: config.serverUrl.replace(/\/$/, ''), // Remove trailing slash
      grpcUrl: config.grpcUrl || '',
      timeout: config.timeout || DEFAULT_TIMEOUT_MS,
      headers: config.headers || {},
      retry: config.retry || { maxRetries: DEFAULT_MAX_RETRIES, backoffMs: DEFAULT_BACKOFF_MS },
    };
  }

  /**
   * Check if a principal is allowed to perform actions on a resource
   */
  async check(
    principal: Principal,
    resource: Resource,
    actions: string[],
    options?: CheckOptions,
  ): Promise<CheckResult> {
    const request: CheckRequest = {
      principal,
      resource,
      actions,
      auxData: options?.auxData,
    };

    const response = await this.sendRequest<CheckResponse>('/api/check', request, options?.timeout);

    // Determine if all actions are allowed
    const allowed = Object.values(response.results).every(
      (result) => result.effect === 'allow',
    );

    return {
      allowed,
      results: response.results,
      requestId: response.requestId,
    };
  }

  /**
   * Check a single action - convenience method
   */
  async isAllowed(
    principal: Principal,
    resource: Resource,
    action: string,
    options?: CheckOptions,
  ): Promise<boolean> {
    const result = await this.check(principal, resource, [action], options);
    return result.results[action]?.effect === 'allow';
  }

  /**
   * Check multiple resources in batch
   */
  async batchCheck(
    principal: Principal,
    checks: Array<{ resource: Resource; actions: string[] }>,
  ): Promise<Record<string, CheckResult>> {
    const request = {
      principal,
      resources: checks,
    };

    const response = await this.sendRequest<{
      requestId: string;
      results: Record<string, Record<string, { effect: Effect; policy: string }>>;
    }>('/api/check/batch', request);

    const results: Record<string, CheckResult> = {};

    for (const [key, actionResults] of Object.entries(response.results)) {
      const allowed = Object.values(actionResults).every(
        (result) => result.effect === 'allow',
      );
      results[key] = {
        allowed,
        results: actionResults,
        requestId: response.requestId,
      };
    }

    return results;
  }

  /**
   * Check server health
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    policiesLoaded: number;
    version: string;
  }> {
    const response = await this.sendRequest<{
      status: string;
      policies_loaded: number;
      version: string;
    }>('/health', null, undefined, 'GET');

    return {
      healthy: response.status === 'healthy',
      policiesLoaded: response.policies_loaded,
      version: response.version,
    };
  }

  /**
   * Get loaded policies info
   */
  async getPolicies(): Promise<{
    resourcePolicies: number;
    derivedRolesPolicies: number;
    resources: string[];
  }> {
    return this.sendRequest('/api/policies', null, undefined, 'GET');
  }

  /**
   * Send HTTP request to the server
   */
  private async sendRequest<T>(
    path: string,
    body: unknown,
    timeout?: number,
    method: 'GET' | 'POST' = 'POST',
  ): Promise<T> {
    const url = `${this.config.serverUrl}${path}`;
    const requestTimeout = timeout || this.config.timeout;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.retry.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), requestTimeout);

        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...this.config.headers,
          },
          body: method === 'POST' ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorBody = await response.text();
          throw new AuthzError(
            `Request failed: ${response.status} ${response.statusText}`,
            response.status,
            errorBody,
          );
        }

        return response.json() as Promise<T>;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on client errors (4xx)
        if (error instanceof AuthzError && error.statusCode >= CLIENT_ERROR_MIN && error.statusCode < CLIENT_ERROR_MAX) {
          throw error;
        }

        // Wait before retry with exponential backoff
        if (attempt < this.config.retry.maxRetries) {
          await this.sleep(this.config.retry.backoffMs * Math.pow(EXPONENTIAL_BACKOFF_BASE, attempt));
        }
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * AuthZ Error
 */
export class AuthzError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = 'AuthzError';
  }
}

/**
 * Create a client instance
 */
export function createClient(config: AuthzClientConfig): AuthzClient {
  return new AuthzClient(config);
}
