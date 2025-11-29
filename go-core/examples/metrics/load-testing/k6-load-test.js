/**
 * k6 Load Testing Script for Authorization Engine
 *
 * This script tests authorization checks with realistic load patterns:
 * - Ramp-up: 0 → 100 VUs over 2 minutes
 * - Sustained: 100 VUs for 5 minutes
 * - Ramp-down: 100 → 0 VUs over 1 minute
 *
 * Run: k6 run k6-load-test.js
 * Run with options: k6 run --vus 50 --duration 2m k6-load-test.js
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom metrics
const authCheckDuration = new Trend('auth_check_duration', true);
const authCheckFailures = new Rate('auth_check_failures');
const authCheckSuccess = new Rate('auth_check_success');
const cacheHitRate = new Rate('cache_hit_rate');
const policyEvaluations = new Counter('policy_evaluations');

// Configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const CHECK_ENDPOINT = `${BASE_URL}/v1/check`;
const METRICS_ENDPOINT = `${BASE_URL}/metrics`;

// Test stages configuration
export let options = {
  stages: [
    { duration: '2m', target: 100 },  // Ramp-up to 100 VUs
    { duration: '5m', target: 100 },  // Sustained load at 100 VUs
    { duration: '1m', target: 0 },    // Ramp-down to 0 VUs
  ],

  // SLO thresholds - matching Phase 4.5 targets
  thresholds: {
    // Authorization check latency: p99 < 10µs (10000ns)
    'http_req_duration{endpoint:check}': [
      'p(95)<5',     // p95 < 5ms (conservative for network overhead)
      'p(99)<10',    // p99 < 10ms (conservative for network overhead)
      'p(99.9)<50',  // p99.9 < 50ms
    ],

    // Success rate: > 99.9%
    'auth_check_success': ['rate>0.999'],

    // Failure rate: < 0.1%
    'auth_check_failures': ['rate<0.001'],

    // Cache hit rate: > 80%
    'cache_hit_rate': ['rate>0.80'],

    // HTTP failures: < 1%
    'http_req_failed': ['rate<0.01'],
  },

  // Additional test options
  noConnectionReuse: false,
  userAgent: 'k6-load-test/1.0',

  // Batch requests for better performance
  batch: 10,
  batchPerHost: 5,
};

// Test data - different authorization scenarios
const POLICIES = ['viewer', 'editor', 'admin', 'owner'];
const ACTIONS = ['read', 'write', 'delete', 'admin'];
const RESOURCE_TYPES = ['document', 'folder', 'project', 'organization'];

// Generate a random user ID
function randomUser() {
  return `user:test_user_${Math.floor(Math.random() * 1000)}@example.com`;
}

// Generate a random resource ID
function randomResource() {
  const type = RESOURCE_TYPES[Math.floor(Math.random() * RESOURCE_TYPES.length)];
  const id = Math.floor(Math.random() * 10000);
  return `resource:${type}:${id}`;
}

// Generate a random action
function randomAction() {
  return ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
}

// Generate a random policy
function randomPolicy() {
  return POLICIES[Math.floor(Math.random() * POLICIES.length)];
}

// Create authorization check request payload
function createCheckPayload() {
  return JSON.stringify({
    subject: randomUser(),
    action: randomAction(),
    resource: randomResource(),
    context: {
      ip_address: `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      timestamp: new Date().toISOString(),
      policy: randomPolicy(),
      session_id: `session_${__VU}_${__ITER}`,
    },
  });
}

// Setup function - runs once per VU
export function setup() {
  console.log('Starting k6 load test...');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Check endpoint: ${CHECK_ENDPOINT}`);

  // Check if server is reachable
  const healthCheck = http.get(`${BASE_URL}/health`);

  if (healthCheck.status !== 200) {
    console.error('Server health check failed!');
    return null;
  }

  console.log('Server is healthy. Starting test...');
  return { startTime: Date.now() };
}

// Main test function - runs for each VU iteration
export default function(data) {
  group('Authorization Check', function() {
    const payload = createCheckPayload();
    const params = {
      headers: {
        'Content-Type': 'application/json',
      },
      tags: {
        endpoint: 'check',
      },
    };

    // Send authorization check request
    const startTime = Date.now();
    const response = http.post(CHECK_ENDPOINT, payload, params);
    const duration = Date.now() - startTime;

    // Record custom metrics
    authCheckDuration.add(duration);
    policyEvaluations.add(1);

    // Validate response
    const success = check(response, {
      'status is 200': (r) => r.status === 200,
      'response has decision': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.hasOwnProperty('allowed');
        } catch (e) {
          return false;
        }
      },
      'response time < 50ms': (r) => r.timings.duration < 50,
    });

    // Record success/failure
    if (success) {
      authCheckSuccess.add(1);
      authCheckFailures.add(0);

      // Check for cache hit indicator
      try {
        const body = JSON.parse(response.body);
        if (body.cached === true) {
          cacheHitRate.add(1);
        } else {
          cacheHitRate.add(0);
        }
      } catch (e) {
        cacheHitRate.add(0);
      }
    } else {
      authCheckSuccess.add(0);
      authCheckFailures.add(1);
      console.error(`Request failed: ${response.status} - ${response.body}`);
    }
  });

  // Test cached requests (repeated authorization checks)
  group('Cached Authorization Check', function() {
    const samePayload = JSON.stringify({
      subject: 'user:cached_test@example.com',
      action: 'read',
      resource: 'resource:document:cached_123',
      context: {
        ip_address: '192.168.1.100',
        timestamp: new Date().toISOString(),
        policy: 'viewer',
      },
    });

    const params = {
      headers: {
        'Content-Type': 'application/json',
      },
      tags: {
        endpoint: 'check',
        cached: 'true',
      },
    };

    const response = http.post(CHECK_ENDPOINT, samePayload, params);

    check(response, {
      'cached request successful': (r) => r.status === 200,
      'cached response time < 5ms': (r) => r.timings.duration < 5,
    });
  });

  // Batch requests test
  group('Batch Authorization Checks', function() {
    const requests = [];

    for (let i = 0; i < 5; i++) {
      requests.push({
        method: 'POST',
        url: CHECK_ENDPOINT,
        body: createCheckPayload(),
        params: {
          headers: {
            'Content-Type': 'application/json',
          },
          tags: {
            endpoint: 'check',
            batch: 'true',
          },
        },
      });
    }

    const responses = http.batch(requests);

    responses.forEach((response) => {
      check(response, {
        'batch request successful': (r) => r.status === 200,
      });
    });
  });

  // Policy-specific tests
  group('Policy-Specific Authorization', function() {
    const policies = ['viewer', 'editor', 'admin'];

    policies.forEach((policy) => {
      const payload = JSON.stringify({
        subject: `user:${policy}_test@example.com`,
        action: policy === 'viewer' ? 'read' : policy === 'editor' ? 'write' : 'delete',
        resource: `resource:document:policy_test_${policy}`,
        context: {
          policy: policy,
          timestamp: new Date().toISOString(),
        },
      });

      const response = http.post(CHECK_ENDPOINT, payload, {
        headers: {
          'Content-Type': 'application/json',
        },
        tags: {
          endpoint: 'check',
          policy: policy,
        },
      });

      check(response, {
        [`${policy} policy successful`]: (r) => r.status === 200,
      });
    });
  });

  // Think time - simulate realistic user behavior
  sleep(Math.random() * 2 + 0.5); // 0.5-2.5 seconds
}

// Teardown function - runs once after all VUs complete
export function teardown(data) {
  console.log('Load test completed.');

  if (data && data.startTime) {
    const duration = (Date.now() - data.startTime) / 1000;
    console.log(`Total test duration: ${duration.toFixed(2)} seconds`);
  }

  // Fetch final metrics
  const metricsResponse = http.get(METRICS_ENDPOINT);

  if (metricsResponse.status === 200) {
    console.log('Final Prometheus metrics:');
    console.log(metricsResponse.body.substring(0, 1000) + '...');
  }
}

// Custom summary for test results
export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'summary.json': JSON.stringify(data),
    'summary.html': htmlReport(data),
  };
}

// Text summary helper
function textSummary(data, options) {
  const indent = options.indent || '';
  const enableColors = options.enableColors || false;

  let output = '\n' + indent + '=== Load Test Summary ===\n\n';

  // Test duration
  output += indent + `Duration: ${(data.state.testRunDurationMs / 1000).toFixed(2)}s\n`;

  // VU metrics
  output += indent + `VUs: ${data.metrics.vus.values.max}\n`;
  output += indent + `Iterations: ${data.metrics.iterations.values.count}\n\n`;

  // HTTP metrics
  output += indent + '--- HTTP Metrics ---\n';
  output += indent + `Requests: ${data.metrics.http_reqs.values.count}\n`;
  output += indent + `Request rate: ${data.metrics.http_reqs.values.rate.toFixed(2)}/s\n`;
  output += indent + `Failed requests: ${(data.metrics.http_req_failed.values.rate * 100).toFixed(2)}%\n`;
  output += indent + `Request duration (p95): ${data.metrics.http_req_duration.values['p(95)'].toFixed(2)}ms\n`;
  output += indent + `Request duration (p99): ${data.metrics.http_req_duration.values['p(99)'].toFixed(2)}ms\n\n`;

  // Custom metrics
  output += indent + '--- Authorization Metrics ---\n';
  output += indent + `Success rate: ${(data.metrics.auth_check_success.values.rate * 100).toFixed(2)}%\n`;
  output += indent + `Failure rate: ${(data.metrics.auth_check_failures.values.rate * 100).toFixed(2)}%\n`;
  output += indent + `Cache hit rate: ${(data.metrics.cache_hit_rate.values.rate * 100).toFixed(2)}%\n`;
  output += indent + `Policy evaluations: ${data.metrics.policy_evaluations.values.count}\n`;

  return output;
}

// HTML report helper
function htmlReport(data) {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>k6 Load Test Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #333; }
    table { border-collapse: collapse; width: 100%; margin-top: 20px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #4CAF50; color: white; }
    .metric-card { background: #f9f9f9; padding: 15px; margin: 10px 0; border-radius: 5px; }
  </style>
</head>
<body>
  <h1>k6 Load Test Report</h1>
  <div class="metric-card">
    <h2>Test Configuration</h2>
    <p>Duration: ${(data.state.testRunDurationMs / 1000).toFixed(2)}s</p>
    <p>Max VUs: ${data.metrics.vus.values.max}</p>
    <p>Total Iterations: ${data.metrics.iterations.values.count}</p>
  </div>
  <div class="metric-card">
    <h2>HTTP Metrics</h2>
    <p>Total Requests: ${data.metrics.http_reqs.values.count}</p>
    <p>Request Rate: ${data.metrics.http_reqs.values.rate.toFixed(2)}/s</p>
    <p>Failed Requests: ${(data.metrics.http_req_failed.values.rate * 100).toFixed(2)}%</p>
    <p>p95 Latency: ${data.metrics.http_req_duration.values['p(95)'].toFixed(2)}ms</p>
    <p>p99 Latency: ${data.metrics.http_req_duration.values['p(99)'].toFixed(2)}ms</p>
  </div>
  <div class="metric-card">
    <h2>Authorization Metrics</h2>
    <p>Success Rate: ${(data.metrics.auth_check_success.values.rate * 100).toFixed(2)}%</p>
    <p>Failure Rate: ${(data.metrics.auth_check_failures.values.rate * 100).toFixed(2)}%</p>
    <p>Cache Hit Rate: ${(data.metrics.cache_hit_rate.values.rate * 100).toFixed(2)}%</p>
    <p>Policy Evaluations: ${data.metrics.policy_evaluations.values.count}</p>
  </div>
</body>
</html>
  `;
}
