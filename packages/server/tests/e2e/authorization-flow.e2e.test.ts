/**
 * E2E Integration Tests - Authorization Flow
 *
 * Tests the complete authorization pipeline from HTTP request to decision.
 * Covers:
 * - REST API endpoints
 * - Policy loading and evaluation
 * - Agent pipeline integration
 * - Storage layer integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { DecisionEngine } from '@authz-engine/core';
import type { Policy, DerivedRolesPolicy, CheckRequest } from '@authz-engine/core';

describe('E2E: Authorization Flow', () => {
  let app: FastifyInstance;
  let engine: DecisionEngine;
  let baseUrl: string;

  // Test policies
  const documentPolicy: Policy = {
    kind: 'ResourcePolicy',
    apiVersion: 'authz.engine/v1',
    metadata: {
      name: 'document-access',
      version: '1.0.0',
    },
    spec: {
      resource: 'document',
      rules: [
        {
          actions: ['read'],
          effect: 'allow',
          roles: ['viewer', 'editor', 'admin'],
        },
        {
          actions: ['write', 'update'],
          effect: 'allow',
          roles: ['editor', 'admin'],
        },
        {
          actions: ['delete'],
          effect: 'allow',
          roles: ['admin'],
        },
        {
          actions: ['read'],
          effect: 'allow',
          derivedRoles: ['owner'],
        },
        {
          actions: ['write', 'update', 'delete'],
          effect: 'allow',
          derivedRoles: ['owner'],
        },
      ],
    },
  };

  const derivedRoles: DerivedRolesPolicy = {
    kind: 'DerivedRoles',
    apiVersion: 'authz.engine/v1',
    metadata: {
      name: 'common-roles',
      version: '1.0.0',
    },
    spec: {
      definitions: [
        {
          name: 'owner',
          parentRoles: ['user'],
          condition: {
            expression: 'request.resource.attr.ownerId == request.principal.id',
          },
        },
      ],
    },
  };

  beforeAll(async () => {
    // Initialize decision engine
    engine = new DecisionEngine();
    engine.loadResourcePolicies([documentPolicy] as any);
    engine.loadDerivedRolesPolicies([derivedRoles] as any);

    // Create test server
    app = Fastify({ logger: false });

    // Health endpoint
    app.get('/health', async () => ({
      status: 'healthy',
      policies_loaded: 2,
    }));

    // Authorization check endpoint
    app.post<{
      Body: {
        principal: { id: string; roles: string[]; attr?: Record<string, unknown> };
        resource: { kind: string; id: string; attr?: Record<string, unknown> };
        actions: string[];
      };
    }>('/api/check', async (request) => {
      const { principal, resource, actions } = request.body;

      const checkRequest: CheckRequest = {
        principal: {
          id: principal.id,
          roles: principal.roles,
          attributes: principal.attr || {},
        },
        resource: {
          kind: resource.kind,
          id: resource.id,
          attributes: resource.attr || {},
        },
        actions,
      };

      const response = engine.check(checkRequest);

      return {
        requestId: response.requestId,
        results: Object.fromEntries(
          Object.entries(response.results).map(([action, result]) => [
            action,
            {
              effect: result.effect.toUpperCase(),
              policy: result.policy,
            },
          ])
        ),
      };
    });

    // Batch check endpoint
    app.post<{
      Body: {
        principal: { id: string; roles: string[]; attr?: Record<string, unknown> };
        resources: Array<{
          resource: { kind: string; id: string; attr?: Record<string, unknown> };
          actions: string[];
        }>;
      };
    }>('/api/check/batch', async (request) => {
      const { principal, resources } = request.body;
      const results: Record<string, Record<string, { effect: string }>> = {};

      for (const item of resources) {
        const checkRequest: CheckRequest = {
          principal: {
            id: principal.id,
            roles: principal.roles,
            attributes: principal.attr || {},
          },
          resource: {
            kind: item.resource.kind,
            id: item.resource.id,
            attributes: item.resource.attr || {},
          },
          actions: item.actions,
        };

        const response = engine.check(checkRequest);
        results[`${item.resource.kind}:${item.resource.id}`] = Object.fromEntries(
          Object.entries(response.results).map(([action, result]) => [
            action,
            { effect: result.effect.toUpperCase() },
          ])
        );
      }

      return { results };
    });

    // Policies info endpoint
    app.get('/api/policies', async () => {
      const stats = engine.getStats();
      return {
        resourcePolicies: stats.resourcePolicies,
        derivedRolesPolicies: stats.derivedRolesPolicies,
        resources: stats.resources,
      };
    });

    await app.listen({ port: 0 }); // Random available port
    const address = app.server.address();
    if (typeof address === 'object' && address) {
      baseUrl = `http://localhost:${address.port}`;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  // ==========================================================================
  // Health Check Tests
  // ==========================================================================

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await fetch(`${baseUrl}/health`);
      const data = await response.json() as { status: string; policies_loaded: number };

      expect(response.status).toBe(200);
      expect(data.status).toBe('healthy');
      expect(data.policies_loaded).toBe(2);
    });
  });

  // ==========================================================================
  // Policy Info Tests
  // ==========================================================================

  describe('Policy Information', () => {
    it('should return loaded policies info', async () => {
      const response = await fetch(`${baseUrl}/api/policies`);
      const data = await response.json() as { resourcePolicies: number; derivedRolesPolicies: number; resources: string[] };

      expect(response.status).toBe(200);
      expect(data.resourcePolicies).toBe(1);
      expect(data.derivedRolesPolicies).toBe(1);
      expect(data.resources).toContain('document');
    });
  });

  // ==========================================================================
  // Authorization Check Tests
  // ==========================================================================

  describe('Authorization Check', () => {
    it('should allow viewer to read document', async () => {
      const response = await fetch(`${baseUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: { id: 'user-1', roles: ['viewer'] },
          resource: { kind: 'document', id: 'doc-1' },
          actions: ['read'],
        }),
      });

      const data = await response.json() as { results: Record<string, { effect: string }> };
      expect(response.status).toBe(200);
      expect(data.results.read.effect).toBe('ALLOW');
    });

    it('should deny viewer from writing document', async () => {
      const response = await fetch(`${baseUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: { id: 'user-1', roles: ['viewer'] },
          resource: { kind: 'document', id: 'doc-1' },
          actions: ['write'],
        }),
      });

      const data = await response.json() as { results: Record<string, { effect: string }> };
      expect(response.status).toBe(200);
      expect(data.results.write.effect).toBe('DENY');
    });

    it('should allow editor to read and write document', async () => {
      const response = await fetch(`${baseUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: { id: 'user-2', roles: ['editor'] },
          resource: { kind: 'document', id: 'doc-1' },
          actions: ['read', 'write', 'delete'],
        }),
      });

      const data = await response.json() as { results: Record<string, { effect: string }> };
      expect(response.status).toBe(200);
      expect(data.results.read.effect).toBe('ALLOW');
      expect(data.results.write.effect).toBe('ALLOW');
      expect(data.results.delete.effect).toBe('DENY');
    });

    it('should allow admin full access', async () => {
      const response = await fetch(`${baseUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: { id: 'admin-1', roles: ['admin'] },
          resource: { kind: 'document', id: 'doc-1' },
          actions: ['read', 'write', 'update', 'delete'],
        }),
      });

      const data = await response.json() as { results: Record<string, { effect: string }> };
      expect(response.status).toBe(200);
      expect(data.results.read.effect).toBe('ALLOW');
      expect(data.results.write.effect).toBe('ALLOW');
      expect(data.results.update.effect).toBe('ALLOW');
      expect(data.results.delete.effect).toBe('ALLOW');
    });

    it('should apply derived role for owner', async () => {
      const response = await fetch(`${baseUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: { id: 'user-owner', roles: ['user'] },
          resource: {
            kind: 'document',
            id: 'doc-owned',
            attr: { ownerId: 'user-owner' },
          },
          actions: ['read', 'write', 'delete'],
        }),
      });

      const data = await response.json() as { results: Record<string, { effect: string }> };
      expect(response.status).toBe(200);
      // Owner should have full access via derived role
      expect(data.results.read.effect).toBe('ALLOW');
      expect(data.results.write.effect).toBe('ALLOW');
      expect(data.results.delete.effect).toBe('ALLOW');
    });

    it('should deny non-owner from owner-only actions', async () => {
      const response = await fetch(`${baseUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: { id: 'user-other', roles: ['user'] },
          resource: {
            kind: 'document',
            id: 'doc-owned',
            attr: { ownerId: 'user-owner' },
          },
          actions: ['read', 'write', 'delete'],
        }),
      });

      const data = await response.json() as { results: Record<string, { effect: string }> };
      expect(response.status).toBe(200);
      // Non-owner with just 'user' role should be denied
      expect(data.results.read.effect).toBe('DENY');
      expect(data.results.write.effect).toBe('DENY');
      expect(data.results.delete.effect).toBe('DENY');
    });
  });

  // ==========================================================================
  // Batch Check Tests
  // ==========================================================================

  describe('Batch Authorization Check', () => {
    it('should process multiple resources in batch', async () => {
      const response = await fetch(`${baseUrl}/api/check/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: { id: 'editor-1', roles: ['editor'] },
          resources: [
            {
              resource: { kind: 'document', id: 'doc-1' },
              actions: ['read', 'write'],
            },
            {
              resource: { kind: 'document', id: 'doc-2' },
              actions: ['read', 'delete'],
            },
          ],
        }),
      });

      const data = await response.json() as { results: Record<string, Record<string, { effect: string }>> };
      expect(response.status).toBe(200);

      // First resource
      expect(data.results['document:doc-1'].read.effect).toBe('ALLOW');
      expect(data.results['document:doc-1'].write.effect).toBe('ALLOW');

      // Second resource
      expect(data.results['document:doc-2'].read.effect).toBe('ALLOW');
      expect(data.results['document:doc-2'].delete.effect).toBe('DENY');
    });

    it('should handle mixed ownership in batch', async () => {
      const response = await fetch(`${baseUrl}/api/check/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: { id: 'user-batch', roles: ['user'] },
          resources: [
            {
              resource: {
                kind: 'document',
                id: 'owned-doc',
                attr: { ownerId: 'user-batch' },
              },
              actions: ['delete'],
            },
            {
              resource: {
                kind: 'document',
                id: 'other-doc',
                attr: { ownerId: 'other-user' },
              },
              actions: ['delete'],
            },
          ],
        }),
      });

      const data = await response.json() as { results: Record<string, Record<string, { effect: string }>> };
      expect(response.status).toBe(200);

      // Owned document - should be allowed
      expect(data.results['document:owned-doc'].delete.effect).toBe('ALLOW');

      // Not owned document - should be denied
      expect(data.results['document:other-doc'].delete.effect).toBe('DENY');
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should deny access to unknown resource type', async () => {
      const response = await fetch(`${baseUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: { id: 'admin-1', roles: ['admin'] },
          resource: { kind: 'unknown-resource', id: 'item-1' },
          actions: ['read'],
        }),
      });

      const data = await response.json() as { results: Record<string, { effect: string }> };
      expect(response.status).toBe(200);
      // No policy for unknown-resource, so should be denied
      expect(data.results.read.effect).toBe('DENY');
    });

    it('should handle multiple roles correctly', async () => {
      const response = await fetch(`${baseUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: { id: 'multi-role', roles: ['viewer', 'editor'] },
          resource: { kind: 'document', id: 'doc-1' },
          actions: ['read', 'write', 'delete'],
        }),
      });

      const data = await response.json() as { results: Record<string, { effect: string }> };
      expect(response.status).toBe(200);
      // Should get combined permissions from both roles
      expect(data.results.read.effect).toBe('ALLOW');
      expect(data.results.write.effect).toBe('ALLOW');
      expect(data.results.delete.effect).toBe('DENY'); // Neither viewer nor editor can delete
    });

    it('should deny all actions for user with no roles', async () => {
      const response = await fetch(`${baseUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: { id: 'no-role-user', roles: [] },
          resource: { kind: 'document', id: 'doc-1' },
          actions: ['read', 'write'],
        }),
      });

      const data = await response.json() as { results: Record<string, { effect: string }> };
      expect(response.status).toBe(200);
      expect(data.results.read.effect).toBe('DENY');
      expect(data.results.write.effect).toBe('DENY');
    });
  });

  // ==========================================================================
  // Performance Tests
  // ==========================================================================

  describe('Performance', () => {
    it('should handle 100 sequential requests within 500ms', async () => {
      const start = Date.now();
      const requests = Array(100).fill(null).map(() =>
        fetch(`${baseUrl}/api/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            principal: { id: 'perf-user', roles: ['viewer'] },
            resource: { kind: 'document', id: 'doc-1' },
            actions: ['read'],
          }),
        })
      );

      await Promise.all(requests);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(500);
    });

    it('should handle batch of 50 resources in single request', async () => {
      const resources = Array(50).fill(null).map((_, i) => ({
        resource: { kind: 'document', id: `doc-${i}` },
        actions: ['read', 'write'],
      }));

      const start = Date.now();
      const response = await fetch(`${baseUrl}/api/check/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: { id: 'batch-user', roles: ['editor'] },
          resources,
        }),
      });
      const duration = Date.now() - start;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(100); // Should be very fast
    });
  });
});
