/**
 * Basic Usage Examples
 *
 * This file demonstrates fundamental usage patterns of the AuthZ Engine SDK.
 */

import {
  createClient,
  type Principal,
  type Resource,
} from '@authz-engine/sdk';

// Initialize the client
const client = createClient({
  serverUrl: process.env.AUTHZ_SERVER_URL || 'http://localhost:3000',
  timeout: 5000,
});

/**
 * Example 1: Simple Permission Check
 *
 * Check if a user can perform a single action on a resource.
 */
async function example1_simpleCheck() {
  console.log('\n=== Example 1: Simple Permission Check ===\n');

  const principal: Principal = {
    id: 'alice@example.com',
    roles: ['viewer'],
    attributes: {
      department: 'marketing',
    },
  };

  const resource: Resource = {
    kind: 'document',
    id: 'doc-001',
    attributes: {
      title: 'Q4 Marketing Plan',
      owner: 'alice@example.com',
    },
  };

  try {
    const canRead = await client.isAllowed(principal, resource, 'read');

    if (canRead) {
      console.log('✓ Alice can read the document');
    } else {
      console.log('✗ Alice cannot read the document');
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Example 2: Multiple Actions Check
 *
 * Check if a user can perform multiple actions and inspect detailed results.
 */
async function example2_multipleActions() {
  console.log('\n=== Example 2: Multiple Actions Check ===\n');

  const principal: Principal = {
    id: 'bob@example.com',
    roles: ['editor'],
    attributes: {
      team: 'content',
      isManager: false,
    },
  };

  const resource: Resource = {
    kind: 'article',
    id: 'article-123',
    attributes: {
      status: 'published',
      owner: 'carol@example.com',
    },
  };

  try {
    const result = await client.check(
      principal,
      resource,
      ['read', 'update', 'delete']
    );

    console.log(`Overall permission: ${result.allowed ? 'ALLOW' : 'DENY'}`);
    console.log(`Request ID: ${result.requestId}\n`);

    // Inspect individual action results
    for (const [action, decision] of Object.entries(result.results)) {
      console.log(
        `  ${action.padEnd(10)} -> ${decision.effect.toUpperCase().padEnd(6)} (policy: ${decision.policy})`
      );
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Example 3: Batch Check
 *
 * Check permissions for multiple resources in a single request.
 * More efficient than making individual requests.
 */
async function example3_batchCheck() {
  console.log('\n=== Example 3: Batch Check ===\n');

  const principal: Principal = {
    id: 'dave@example.com',
    roles: ['admin'],
    attributes: {
      department: 'operations',
    },
  };

  const resourcesAndActions = [
    {
      resource: {
        kind: 'document',
        id: 'doc-001',
        attributes: { owner: 'alice@example.com' },
      },
      actions: ['read', 'write'],
    },
    {
      resource: {
        kind: 'document',
        id: 'doc-002',
        attributes: { owner: 'bob@example.com' },
      },
      actions: ['read', 'delete'],
    },
    {
      resource: {
        kind: 'folder',
        id: 'folder-001',
        attributes: { department: 'engineering' },
      },
      actions: ['create', 'list'],
    },
  ];

  try {
    const results = await client.batchCheck(principal, resourcesAndActions);

    console.log(`Batch check completed. Results:\n`);

    for (const [resourceKey, result] of Object.entries(results)) {
      const status = result.allowed ? '✓ ALLOW' : '✗ DENY';
      console.log(`  ${resourceKey}: ${status}`);

      for (const [action, decision] of Object.entries(result.results)) {
        const effect = decision.effect === 'allow' ? '✓' : '✗';
        console.log(`    ${effect} ${action}`);
      }
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Example 4: Check with Auxiliary Data
 *
 * Pass additional context that can be used in policy evaluation.
 */
async function example4_auxiliaryData() {
  console.log('\n=== Example 4: Check with Auxiliary Data ===\n');

  const principal: Principal = {
    id: 'eve@example.com',
    roles: ['analyst'],
    attributes: {
      department: 'data',
    },
  };

  const resource: Resource = {
    kind: 'report',
    id: 'report-sensitive-001',
    attributes: {
      classification: 'confidential',
      owner: 'frank@example.com',
    },
  };

  try {
    // Pass additional context like request IP, timestamp, etc.
    const result = await client.check(
      principal,
      resource,
      ['view', 'export'],
      {
        auxData: {
          ipAddress: '192.168.1.100',
          timestamp: new Date().toISOString(),
          environment: 'production',
          userAgent: 'PostmanRuntime/7.32.3',
        },
      }
    );

    console.log(`Report access check:`);
    console.log(`  Overall: ${result.allowed ? 'ALLOW' : 'DENY'}`);
    console.log(`  View: ${result.results['view'].effect}`);
    console.log(`  Export: ${result.results['export'].effect}`);
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Example 5: Server Health and Policy Info
 *
 * Check server health and retrieve information about loaded policies.
 */
async function example5_healthAndPolicies() {
  console.log('\n=== Example 5: Server Health and Policies ===\n');

  try {
    // Check server health
    const health = await client.healthCheck();
    console.log(`Server Status:`);
    console.log(`  Healthy: ${health.healthy}`);
    console.log(`  Version: ${health.version}`);
    console.log(`  Policies loaded: ${health.policiesLoaded}\n`);

    // Get policy information
    const policies = await client.getPolicies();
    console.log(`Loaded Policies:`);
    console.log(`  Resource policies: ${policies.resourcePolicies}`);
    console.log(`  Derived roles policies: ${policies.derivedRolesPolicies}`);
    console.log(
      `  Resource types: ${policies.resources.join(', ') || 'none'}`
    );
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Example 6: Different User Roles
 *
 * Demonstrates how different roles get different permissions.
 */
async function example6_differentRoles() {
  console.log('\n=== Example 6: Different User Roles ===\n');

  const resource: Resource = {
    kind: 'document',
    id: 'sensitive-doc-001',
    attributes: {
      title: 'Financial Report',
      owner: 'finance@example.com',
      sensitivity: 'high',
    },
  };

  const users = [
    { id: 'viewer@example.com', roles: ['viewer'] },
    { id: 'editor@example.com', roles: ['editor'] },
    { id: 'admin@example.com', roles: ['admin'] },
  ];

  console.log(`Checking permissions for resource: ${resource.id}\n`);

  for (const user of users) {
    try {
      const principal: Principal = {
        ...user,
        attributes: { department: 'finance' },
      };

      const result = await client.check(principal, resource, [
        'read',
        'write',
        'delete',
      ]);

      console.log(`${user.id} (${user.roles.join(', ')}):`);
      console.log(`  read: ${result.results['read'].effect}`);
      console.log(`  write: ${result.results['write'].effect}`);
      console.log(`  delete: ${result.results['delete'].effect}\n`);
    } catch (error) {
      console.error(`Error for ${user.id}:`, error);
    }
  }
}

/**
 * Example 7: Different Resource Types
 *
 * Demonstrates checking permissions on different resource types.
 */
async function example7_differentResourceTypes() {
  console.log('\n=== Example 7: Different Resource Types ===\n');

  const principal: Principal = {
    id: 'user@example.com',
    roles: ['member'],
    attributes: {
      subscription: 'premium',
    },
  };

  const resources: Array<[string, Resource]> = [
    [
      'Document',
      {
        kind: 'document',
        id: 'doc-1',
        attributes: { status: 'published' },
      },
    ],
    [
      'Folder',
      {
        kind: 'folder',
        id: 'folder-1',
        attributes: { isPublic: true },
      },
    ],
    [
      'Comment',
      {
        kind: 'comment',
        id: 'comment-1',
        attributes: { author: 'user@example.com' },
      },
    ],
    [
      'API Key',
      {
        kind: 'api_key',
        id: 'key-1',
        attributes: { owner: 'user@example.com' },
      },
    ],
  ];

  console.log(`Checking read permission across resource types:\n`);

  for (const [name, resource] of resources) {
    try {
      const canRead = await client.isAllowed(principal, resource, 'read');
      const status = canRead ? '✓' : '✗';
      console.log(`  ${status} ${name.padEnd(15)} (${resource.kind})`);
    } catch (error) {
      console.error(`  Error checking ${name}:`, error);
    }
  }
}

/**
 * Run all examples
 */
async function runAllExamples() {
  console.log('AuthZ Engine SDK - Basic Usage Examples');
  console.log('=====================================');

  try {
    await example1_simpleCheck();
    await example2_multipleActions();
    await example3_batchCheck();
    await example4_auxiliaryData();
    await example5_healthAndPolicies();
    await example6_differentRoles();
    await example7_differentResourceTypes();

    console.log('\n=====================================');
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
  example1_simpleCheck,
  example2_multipleActions,
  example3_batchCheck,
  example4_auxiliaryData,
  example5_healthAndPolicies,
  example6_differentRoles,
  example7_differentResourceTypes,
};
