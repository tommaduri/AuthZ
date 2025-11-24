/**
 * k6 Load Test for Authorization Check API
 *
 * Run: k6 run packages/server/tests/load/k6-authz-check.js
 *
 * Test scenarios:
 * 1. Smoke test: Low load to verify system works
 * 2. Load test: Normal expected load
 * 3. Stress test: Push to breaking point
 * 4. Spike test: Sudden traffic spike
 * 5. Soak test: Extended duration
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend, Gauge } from 'k6/metrics';
import { randomItem, randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

// Custom metrics
const checkRequests = new Counter('authz_check_requests');
const checkAllowed = new Counter('authz_check_allowed');
const checkDenied = new Counter('authz_check_denied');
const checkErrors = new Counter('authz_check_errors');
const checkLatency = new Trend('authz_check_latency', true);
const errorRate = new Rate('authz_error_rate');
const policiesLoaded = new Gauge('authz_policies_loaded');

// Configuration from environment
const BASE_URL = __ENV.AUTHZ_URL || 'http://localhost:3592';

// Test data
const ROLES = ['viewer', 'editor', 'admin', 'user'];
const RESOURCES = ['document', 'project', 'user', 'team', 'report', 'dashboard'];
const ACTIONS = ['read', 'write', 'update', 'delete', 'share', 'export'];
const USER_IDS = Array.from({ length: 100 }, (_, i) => `user-${i}`);

// Scenario configurations
export const options = {
  scenarios: {
    // Smoke test: verify basic functionality
    smoke: {
      executor: 'constant-vus',
      vus: 1,
      duration: '30s',
      tags: { scenario: 'smoke' },
      exec: 'smokeTest',
    },
    // Load test: normal expected load
    load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 50 },   // Ramp up
        { duration: '3m', target: 50 },   // Stay at 50 VUs
        { duration: '1m', target: 100 },  // Ramp up more
        { duration: '3m', target: 100 },  // Stay at 100 VUs
        { duration: '1m', target: 0 },    // Ramp down
      ],
      tags: { scenario: 'load' },
      exec: 'loadTest',
      startTime: '35s', // Start after smoke test
    },
    // Stress test: push to breaking point
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 100 },
        { duration: '2m', target: 200 },
        { duration: '2m', target: 300 },
        { duration: '2m', target: 400 },
        { duration: '1m', target: 0 },
      ],
      tags: { scenario: 'stress' },
      exec: 'stressTest',
      startTime: '10m', // Start after load test
    },
    // Spike test: sudden traffic spike
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '10s', target: 500 }, // Sudden spike
        { duration: '1m', target: 500 },
        { duration: '30s', target: 10 },
        { duration: '30s', target: 0 },
      ],
      tags: { scenario: 'spike' },
      exec: 'spikeTest',
      startTime: '20m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<200', 'p(99)<500'],
    http_req_failed: ['rate<0.01'],
    authz_check_latency: ['p(95)<100', 'p(99)<200'],
    authz_error_rate: ['rate<0.01'],
  },
};

// Helper: Make authorization check request
function authzCheck(principal, resource, actions) {
  const payload = JSON.stringify({
    principal: {
      id: principal.id,
      roles: principal.roles,
      attr: principal.attr || {},
    },
    resource: {
      kind: resource.kind,
      id: resource.id,
      attr: resource.attr || {},
    },
    actions: actions,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
    tags: { name: 'AuthzCheck' },
  };

  const start = Date.now();
  const response = http.post(`${BASE_URL}/api/check`, payload, params);
  const latency = Date.now() - start;

  checkRequests.add(1);
  checkLatency.add(latency);

  const isValid = check(response, {
    'status is 200': (r) => r.status === 200,
    'has results': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.results !== undefined;
      } catch {
        return false;
      }
    },
    'latency < 100ms': () => latency < 100,
  });

  if (!isValid) {
    checkErrors.add(1);
    errorRate.add(1);
    return null;
  }

  errorRate.add(0);

  try {
    const body = JSON.parse(response.body);
    const results = body.results;

    // Count allowed vs denied
    for (const action of actions) {
      if (results[action]?.effect === 'EFFECT_ALLOW') {
        checkAllowed.add(1);
      } else {
        checkDenied.add(1);
      }
    }

    return body;
  } catch {
    return null;
  }
}

// Helper: Batch authorization check
function authzBatchCheck(principal, resourcesWithActions) {
  const payload = JSON.stringify({
    principal: {
      id: principal.id,
      roles: principal.roles,
      attr: principal.attr || {},
    },
    resources: resourcesWithActions.map((r) => ({
      resource: {
        kind: r.resource.kind,
        id: r.resource.id,
        attr: r.resource.attr || {},
      },
      actions: r.actions,
    })),
  });

  const params = {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'AuthzBatchCheck' },
  };

  const start = Date.now();
  const response = http.post(`${BASE_URL}/api/check/batch`, payload, params);
  const latency = Date.now() - start;

  checkRequests.add(resourcesWithActions.length);
  checkLatency.add(latency);

  check(response, {
    'batch status is 200': (r) => r.status === 200,
    'batch has results': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.results !== undefined;
      } catch {
        return false;
      }
    },
  });

  return response;
}

// Helper: Check health
function healthCheck() {
  const response = http.get(`${BASE_URL}/health`);

  check(response, {
    'health status is 200': (r) => r.status === 200,
    'health is healthy': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.status === 'healthy';
      } catch {
        return false;
      }
    },
  });

  try {
    const body = JSON.parse(response.body);
    if (body.policies_loaded !== undefined) {
      policiesLoaded.add(body.policies_loaded);
    }
  } catch {
    // Ignore
  }

  return response;
}

// Helper: Generate random request
function generateRandomRequest() {
  const userId = randomItem(USER_IDS);
  const numRoles = randomIntBetween(1, 3);
  const roles = [];
  for (let i = 0; i < numRoles; i++) {
    const role = randomItem(ROLES);
    if (!roles.includes(role)) roles.push(role);
  }

  const resourceKind = randomItem(RESOURCES);
  const resourceId = `${resourceKind}-${randomIntBetween(1, 1000)}`;

  const numActions = randomIntBetween(1, 4);
  const actions = [];
  for (let i = 0; i < numActions; i++) {
    const action = randomItem(ACTIONS);
    if (!actions.includes(action)) actions.push(action);
  }

  return {
    principal: { id: userId, roles },
    resource: { kind: resourceKind, id: resourceId },
    actions,
  };
}

// ==========================================================================
// Test Scenarios
// ==========================================================================

export function smokeTest() {
  group('Smoke Test', () => {
    // Health check
    healthCheck();

    // Simple authorization check
    authzCheck(
      { id: 'smoke-user', roles: ['viewer'] },
      { kind: 'document', id: 'doc-1' },
      ['read']
    );

    // Sleep between requests
    sleep(1);
  });
}

export function loadTest() {
  group('Load Test', () => {
    // Random authorization checks
    const request = generateRandomRequest();
    authzCheck(request.principal, request.resource, request.actions);

    // Occasionally do batch checks
    if (randomIntBetween(1, 10) === 1) {
      const resources = [];
      for (let i = 0; i < randomIntBetween(3, 10); i++) {
        const r = generateRandomRequest();
        resources.push({
          resource: r.resource,
          actions: r.actions,
        });
      }
      authzBatchCheck(request.principal, resources);
    }

    // Minimal sleep for realistic pacing
    sleep(randomIntBetween(50, 200) / 1000);
  });
}

export function stressTest() {
  group('Stress Test', () => {
    // High-frequency requests
    const request = generateRandomRequest();
    authzCheck(request.principal, request.resource, request.actions);

    // More batch checks under stress
    if (randomIntBetween(1, 5) === 1) {
      const resources = [];
      for (let i = 0; i < randomIntBetween(10, 20); i++) {
        const r = generateRandomRequest();
        resources.push({
          resource: r.resource,
          actions: r.actions,
        });
      }
      authzBatchCheck(request.principal, resources);
    }

    // Very minimal sleep
    sleep(randomIntBetween(10, 50) / 1000);
  });
}

export function spikeTest() {
  group('Spike Test', () => {
    // Same as load test but no sleep during spike
    const request = generateRandomRequest();
    authzCheck(request.principal, request.resource, request.actions);

    // No sleep during spike to maximize load
  });
}

// ==========================================================================
// Setup and Teardown
// ==========================================================================

export function setup() {
  // Verify server is running
  const health = http.get(`${BASE_URL}/health`);

  if (health.status !== 200) {
    throw new Error(`Server not available at ${BASE_URL}`);
  }

  const body = JSON.parse(health.body);
  console.log(`Server healthy. Policies loaded: ${body.policies_loaded}`);

  // Return data available in test functions
  return {
    serverUrl: BASE_URL,
    policiesLoaded: body.policies_loaded,
  };
}

export function teardown(data) {
  console.log(`Load test complete. Server URL: ${data.serverUrl}`);
}

// Default function for quick runs
export default function () {
  loadTest();
}
