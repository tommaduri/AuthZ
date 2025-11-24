/**
 * Advanced Usage Examples
 *
 * This file demonstrates advanced patterns and techniques.
 */

import {
  createClient,
  AuthzError,
  type Principal,
  type Resource,
} from '@authz-engine/sdk';

// Initialize client with custom retry and timeout settings
const client = createClient({
  serverUrl: process.env.AUTHZ_SERVER_URL || 'http://localhost:3000',
  timeout: 10000,
  retry: {
    maxRetries: 5,
    backoffMs: 200,
  },
  headers: {
    'X-Request-Source': 'sdk-examples',
  },
});

/**
 * Example 1: Advanced Error Handling
 *
 * Demonstrates comprehensive error handling for different scenarios.
 */
async function example1_advancedErrorHandling() {
  console.log('\n=== Example 1: Advanced Error Handling ===\n');

  const principal: Principal = {
    id: 'user@example.com',
    roles: ['viewer'],
    attributes: {},
  };

  const resource: Resource = {
    kind: 'document',
    id: 'doc-001',
    attributes: {},
  };

  try {
    const result = await client.check(principal, resource, ['read']);
    console.log('Check successful:', result.allowed);
  } catch (error) {
    if (error instanceof AuthzError) {
      // Handle AuthZ-specific errors
      switch (error.statusCode) {
        case 400:
          console.error('Bad Request:', error.message);
          console.error('Request body:', error.body);
          break;

        case 401:
          console.error('Unauthorized - Check authentication');
          break;

        case 403:
          console.error('Forbidden - Authorization failed');
          break;

        case 408:
          console.error('Request timeout - Server took too long');
          break;

        case 500:
          console.error('Server error:', error.message);
          // Could implement retry logic here
          break;

        case 503:
          console.error('Service unavailable - Server is down');
          // Could implement circuit breaker pattern
          break;

        default:
          console.error(`HTTP ${error.statusCode}:`, error.message);
      }
    } else if (error instanceof Error) {
      // Handle other errors (network, timeouts, etc.)
      console.error('Network error:', error.message);

      // Could implement fallback authorization logic here
      console.log('Falling back to deny-all policy...');
    } else {
      console.error('Unknown error:', error);
    }
  }
}

/**
 * Example 2: Custom Retry Logic
 *
 * Implements additional retry logic on top of the SDK's built-in retries.
 */
async function example2_customRetryLogic() {
  console.log('\n=== Example 2: Custom Retry Logic ===\n');

  async function checkWithCustomRetry(
    principal: Principal,
    resource: Resource,
    action: string,
    maxAttempts = 3,
    backoffMs = 500
  ) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`Attempt ${attempt}/${maxAttempts}...`);
        const result = await client.isAllowed(principal, resource, action);
        console.log(`✓ Attempt ${attempt} succeeded`);
        return result;
      } catch (error) {
        if (attempt === maxAttempts) {
          throw error;
        }

        if (error instanceof AuthzError && error.statusCode < 500) {
          // Don't retry on client errors
          throw error;
        }

        // Exponential backoff
        const delay = backoffMs * Math.pow(2, attempt - 1);
        console.log(
          `✗ Attempt ${attempt} failed, waiting ${delay}ms before retry...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  try {
    const principal: Principal = {
      id: 'user@example.com',
      roles: ['user'],
      attributes: {},
    };

    const resource: Resource = {
      kind: 'document',
      id: 'doc-001',
      attributes: {},
    };

    const allowed = await checkWithCustomRetry(principal, resource, 'read');
    console.log(`Final result: ${allowed ? 'ALLOWED' : 'DENIED'}`);
  } catch (error) {
    console.error('Failed after all retries:', error);
  }
}

/**
 * Example 3: Caching Authorization Decisions
 *
 * Implements a simple cache to avoid repeated authorization checks.
 */
async function example3_cachingDecisions() {
  console.log('\n=== Example 3: Caching Authorization Decisions ===\n');

  // Simple in-memory cache with TTL
  class AuthorizationCache {
    private cache: Map<
      string,
      { allowed: boolean; expiresAt: number }
    > = new Map();
    private ttlMs: number;

    constructor(ttlMs = 60000) {
      // 1 minute default
      this.ttlMs = ttlMs;
    }

    private getCacheKey(
      principal: Principal,
      resource: Resource,
      action: string
    ): string {
      return `${principal.id}:${resource.kind}:${resource.id}:${action}`;
    }

    get(
      principal: Principal,
      resource: Resource,
      action: string
    ): boolean | null {
      const key = this.getCacheKey(principal, resource, action);
      const entry = this.cache.get(key);

      if (!entry) {
        return null;
      }

      if (Date.now() > entry.expiresAt) {
        this.cache.delete(key);
        return null;
      }

      return entry.allowed;
    }

    set(
      principal: Principal,
      resource: Resource,
      action: string,
      allowed: boolean
    ): void {
      const key = this.getCacheKey(principal, resource, action);
      this.cache.set(key, {
        allowed,
        expiresAt: Date.now() + this.ttlMs,
      });
    }

    clear(): void {
      this.cache.clear();
    }

    stats(): { size: number } {
      return { size: this.cache.size };
    }
  }

  const cache = new AuthorizationCache(5000); // 5 second TTL

  async function isAllowedWithCache(
    principal: Principal,
    resource: Resource,
    action: string
  ): Promise<boolean> {
    // Check cache first
    const cached = cache.get(principal, resource, action);
    if (cached !== null) {
      console.log('  ✓ Cache hit');
      return cached;
    }

    // Cache miss - make actual request
    console.log('  ✗ Cache miss - making request');
    const allowed = await client.isAllowed(principal, resource, action);

    // Store in cache
    cache.set(principal, resource, action, allowed);
    return allowed;
  }

  try {
    const principal: Principal = {
      id: 'user@example.com',
      roles: ['user'],
      attributes: {},
    };

    const resource: Resource = {
      kind: 'document',
      id: 'doc-001',
      attributes: {},
    };

    // First check - cache miss
    console.log('First check:');
    await isAllowedWithCache(principal, resource, 'read');

    // Second check - cache hit
    console.log('Second check (immediate):');
    await isAllowedWithCache(principal, resource, 'read');

    // Third check - still cache hit
    console.log('Third check (still within TTL):');
    await isAllowedWithCache(principal, resource, 'read');

    console.log(`Cache stats:`, cache.stats());

    // Wait for TTL to expire
    console.log('Waiting for cache TTL to expire...');
    await new Promise((resolve) => setTimeout(resolve, 6000));

    // Fourth check - cache expired, new request
    console.log('Fourth check (after TTL):');
    await isAllowedWithCache(principal, resource, 'read');
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Example 4: Fallback Authorization Pattern
 *
 * Implements a fallback pattern when the authorization service is unavailable.
 */
async function example4_fallbackAuthorization() {
  console.log('\n=== Example 4: Fallback Authorization ===\n');

  interface FallbackPolicy {
    checkAction(
      principal: Principal,
      resource: Resource,
      action: string
    ): boolean;
  }

  // Simple fallback policy - deny all except specific cases
  class DenyAllFallback implements FallbackPolicy {
    checkAction(
      principal: Principal,
      _resource: Resource,
      _action: string
    ): boolean {
      // Only allow if user is an admin
      return principal.roles.includes('admin');
    }
  }

  // More permissive fallback - allow reads for everyone
  class AllowReadsFallback implements FallbackPolicy {
    checkAction(
      principal: Principal,
      _resource: Resource,
      action: string
    ): boolean {
      return action === 'read';
    }
  }

  let fallbackPolicy: FallbackPolicy = new DenyAllFallback();

  async function isAllowedWithFallback(
    principal: Principal,
    resource: Resource,
    action: string
  ): Promise<{ allowed: boolean; source: 'primary' | 'fallback' }> {
    try {
      const allowed = await client.isAllowed(principal, resource, action);
      return { allowed, source: 'primary' };
    } catch (error) {
      if (error instanceof AuthzError && error.statusCode >= 500) {
        console.log('Primary service unavailable, using fallback policy');
        const allowed = fallbackPolicy.checkAction(principal, resource, action);
        return { allowed, source: 'fallback' };
      }
      throw error;
    }
  }

  try {
    const principal: Principal = {
      id: 'user@example.com',
      roles: ['user'],
      attributes: {},
    };

    const resource: Resource = {
      kind: 'document',
      id: 'doc-001',
      attributes: {},
    };

    const result = await isAllowedWithFallback(principal, resource, 'read');
    console.log(`Result: ${result.allowed} (source: ${result.source})`);
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Example 5: Concurrent Checks
 *
 * Efficiently check permissions for multiple actions/resources in parallel.
 */
async function example5_concurrentChecks() {
  console.log('\n=== Example 5: Concurrent Checks ===\n');

  const principal: Principal = {
    id: 'user@example.com',
    roles: ['editor'],
    attributes: {},
  };

  const resources: Resource[] = [
    { kind: 'document', id: 'doc-1', attributes: {} },
    { kind: 'document', id: 'doc-2', attributes: {} },
    { kind: 'document', id: 'doc-3', attributes: {} },
    { kind: 'folder', id: 'folder-1', attributes: {} },
  ];

  const actions = ['read', 'write', 'delete'];

  try {
    console.log('Checking permissions in parallel...\n');

    // Create array of check promises
    const promises = resources.flatMap((resource) =>
      actions.map(async (action) => {
        try {
          const allowed = await client.isAllowed(principal, resource, action);
          return {
            resource: `${resource.kind}:${resource.id}`,
            action,
            allowed,
          };
        } catch (error) {
          return {
            resource: `${resource.kind}:${resource.id}`,
            action,
            allowed: false,
            error: true,
          };
        }
      })
    );

    const results = await Promise.all(promises);

    // Group results by resource
    const grouped: Record<string, Record<string, boolean>> = {};
    for (const result of results) {
      if (!grouped[result.resource]) {
        grouped[result.resource] = {};
      }
      grouped[result.resource][result.action] = result.allowed;
    }

    // Display results
    for (const [resource, actionResults] of Object.entries(grouped)) {
      console.log(`${resource}:`);
      for (const [action, allowed] of Object.entries(actionResults)) {
        const symbol = allowed ? '✓' : '✗';
        console.log(`  ${symbol} ${action}`);
      }
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Example 6: Request ID Tracking
 *
 * Demonstrates using request IDs for debugging and audit trails.
 */
async function example6_requestIdTracking() {
  console.log('\n=== Example 6: Request ID Tracking ===\n');

  class RequestLogger {
    private requests: Map<
      string,
      {
        timestamp: Date;
        principal: Principal;
        resource: Resource;
        action: string;
        result: boolean;
      }
    > = new Map();

    async checkAndLog(
      principal: Principal,
      resource: Resource,
      action: string
    ): Promise<boolean> {
      const result = await client.check(principal, resource, [action]);
      const allowed = result.results[action]?.effect === 'allow';

      this.requests.set(result.requestId, {
        timestamp: new Date(),
        principal,
        resource,
        action,
        result: allowed,
      });

      return allowed;
    }

    getLog(requestId: string) {
      return this.requests.get(requestId);
    }

    getAllLogs() {
      return Array.from(this.requests.entries());
    }
  }

  const logger = new RequestLogger();

  try {
    const principal: Principal = {
      id: 'user@example.com',
      roles: ['user'],
      attributes: {},
    };

    const resource: Resource = {
      kind: 'document',
      id: 'doc-001',
      attributes: {},
    };

    // Make multiple checks
    console.log('Making authorization checks...\n');
    await logger.checkAndLog(principal, resource, 'read');
    await logger.checkAndLog(principal, resource, 'write');
    await logger.checkAndLog(principal, resource, 'delete');

    // Display audit log
    console.log('Request Log:');
    for (const [requestId, entry] of logger.getAllLogs()) {
      console.log(`  ${requestId}:`);
      console.log(
        `    ${entry.timestamp.toISOString()} - ${entry.principal.id} ${entry.action} ${entry.resource.kind}:${entry.resource.id}`
      );
      console.log(`    Result: ${entry.result ? 'ALLOW' : 'DENY'}`);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Example 7: Rate-Limited Authorization
 *
 * Implements rate limiting to avoid overwhelming the authorization service.
 */
async function example7_rateLimitedAuthorization() {
  console.log('\n=== Example 7: Rate-Limited Authorization ===\n');

  class RateLimitedClient {
    private requestsInWindow: number[] = [];
    private readonly maxRequests: number;
    private readonly windowMs: number;

    constructor(maxRequests = 100, windowMs = 10000) {
      // 100 requests per 10 seconds
      this.maxRequests = maxRequests;
      this.windowMs = windowMs;
    }

    private cleanupWindow(): void {
      const now = Date.now();
      this.requestsInWindow = this.requestsInWindow.filter(
        (timestamp) => now - timestamp < this.windowMs
      );
    }

    async isAllowed(
      principal: Principal,
      resource: Resource,
      action: string
    ): Promise<boolean> {
      this.cleanupWindow();

      if (this.requestsInWindow.length >= this.maxRequests) {
        throw new Error('Rate limit exceeded');
      }

      this.requestsInWindow.push(Date.now());
      return client.isAllowed(principal, resource, action);
    }

    getStats(): { current: number; limit: number; remaining: number } {
      this.cleanupWindow();
      return {
        current: this.requestsInWindow.length,
        limit: this.maxRequests,
        remaining: this.maxRequests - this.requestsInWindow.length,
      };
    }
  }

  const rateLimitedClient = new RateLimitedClient(5, 5000); // 5 requests per 5 seconds

  try {
    const principal: Principal = {
      id: 'user@example.com',
      roles: ['user'],
      attributes: {},
    };

    const resource: Resource = {
      kind: 'document',
      id: 'doc-001',
      attributes: {},
    };

    // Make some requests
    for (let i = 1; i <= 6; i++) {
      try {
        await rateLimitedClient.isAllowed(principal, resource, 'read');
        const stats = rateLimitedClient.getStats();
        console.log(
          `Request ${i}: OK (${stats.current}/${stats.limit}, ${stats.remaining} remaining)`
        );
      } catch (error) {
        console.log(`Request ${i}: RATE LIMITED`);
      }
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Run all examples
 */
async function runAllExamples() {
  console.log('AuthZ Engine SDK - Advanced Usage Examples');
  console.log('=========================================');

  try {
    await example1_advancedErrorHandling();
    await example2_customRetryLogic();
    await example3_cachingDecisions();
    await example4_fallbackAuthorization();
    await example5_concurrentChecks();
    await example6_requestIdTracking();
    await example7_rateLimitedAuthorization();

    console.log('\n=========================================');
    console.log('All examples completed!');
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples();
}

export {
  example1_advancedErrorHandling,
  example2_customRetryLogic,
  example3_cachingDecisions,
  example4_fallbackAuthorization,
  example5_concurrentChecks,
  example6_requestIdTracking,
  example7_rateLimitedAuthorization,
};
