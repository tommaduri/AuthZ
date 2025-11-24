/**
 * Web Server Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaygroundWebServer } from '../src/web-server.js';

describe('PlaygroundWebServer', () => {
  let server: PlaygroundWebServer;
  const port = 3099; // Use unique port for tests
  const baseUrl = `http://localhost:${port}`;

  beforeAll(async () => {
    server = new PlaygroundWebServer({ port, host: 'localhost' });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('GET /health', () => {
    it('should return healthy status', async () => {
      const response = await fetch(`${baseUrl}/health`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('healthy');
    });
  });

  describe('GET /examples', () => {
    it('should return example policies', async () => {
      const response = await fetch(`${baseUrl}/examples`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBeGreaterThan(0);
      expect(data.data[0]).toHaveProperty('name');
      expect(data.data[0]).toHaveProperty('yaml');
      expect(data.data[0]).toHaveProperty('sampleRequests');
    });
  });

  describe('GET /stats', () => {
    it('should return statistics', async () => {
      const response = await fetch(`${baseUrl}/stats`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('resourcePolicies');
      expect(data.data).toHaveProperty('derivedRolesPolicies');
    });
  });

  describe('POST /load', () => {
    it('should load a policy', async () => {
      const policy = `
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: test-policy
spec:
  resource: document
  rules:
    - name: allow-read
      actions: ["read"]
      effect: allow
      roles: ["user"]
`;

      const response = await fetch(`${baseUrl}/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy }),
      });

      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.loaded).toHaveLength(1);
      expect(data.data.loaded[0].name).toBe('test-policy');
    });

    it('should return error for missing policy', async () => {
      const response = await fetch(`${baseUrl}/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Missing required field');
    });
  });

  describe('POST /simulate', () => {
    const policy = `
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy
spec:
  resource: document
  rules:
    - name: admin-access
      actions: ["*"]
      effect: allow
      roles: ["admin"]
    - name: user-read
      actions: ["read"]
      effect: allow
      roles: ["user"]
`;

    it('should simulate policy with inline policy', async () => {
      const response = await fetch(`${baseUrl}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          policy,
          request: {
            principal: { id: 'user1', roles: ['user'], attributes: {} },
            resource: { kind: 'document', id: 'doc1', attributes: {} },
            actions: ['read', 'update'],
          },
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.results.read.effect).toBe('allow');
      expect(data.data.results.update.effect).toBe('deny');
    });

    it('should return error for missing request', async () => {
      const response = await fetch(`${baseUrl}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });
  });

  describe('POST /explain', () => {
    const policy = `
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy
spec:
  resource: document
  rules:
    - name: user-read
      actions: ["read"]
      effect: allow
      roles: ["user"]
`;

    it('should explain a decision', async () => {
      const response = await fetch(`${baseUrl}/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          policy,
          request: {
            principal: { id: 'user1', roles: ['user'], attributes: {} },
            resource: { kind: 'document', id: 'doc1', attributes: {} },
            actions: ['read'],
          },
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.trace).toBeInstanceOf(Array);
      expect(data.data.rulesEvaluated).toBeInstanceOf(Array);
    });
  });

  describe('POST /whatif', () => {
    const policy = `
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy
spec:
  resource: document
  rules:
    - name: admin-access
      actions: ["*"]
      effect: allow
      roles: ["admin"]
    - name: user-read
      actions: ["read"]
      effect: allow
      roles: ["user"]
`;

    it('should analyze what-if scenario', async () => {
      // First simulate
      await fetch(`${baseUrl}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          policy,
          request: {
            principal: { id: 'user1', roles: ['user'], attributes: {} },
            resource: { kind: 'document', id: 'doc1', attributes: {} },
            actions: ['read', 'update'],
          },
        }),
      });

      // Then what-if
      const response = await fetch(`${baseUrl}/whatif`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changes: {
            principal: { roles: ['admin'] },
          },
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.changed).toBe(true);
      expect(data.data.changes).toContain("Action 'update': deny -> allow");
    });
  });

  describe('POST /rules', () => {
    const policy = `
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy
spec:
  resource: document
  rules:
    - name: admin-access
      actions: ["*"]
      effect: allow
      roles: ["admin"]
    - name: user-read
      actions: ["read"]
      effect: allow
      roles: ["user"]
`;

    it('should find matching rules', async () => {
      const response = await fetch(`${baseUrl}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          policy,
          request: {
            principal: { id: 'user1', roles: ['user'], attributes: {} },
            resource: { kind: 'document', id: 'doc1', attributes: {} },
            actions: ['read'],
          },
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBeGreaterThan(0);
    });
  });

  describe('POST /tests', () => {
    const policy = `
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy
spec:
  resource: document
  rules:
    - name: admin-access
      actions: ["*"]
      effect: allow
      roles: ["admin"]
`;

    it('should generate test cases', async () => {
      const response = await fetch(`${baseUrl}/tests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy }),
      });

      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBeGreaterThan(0);
      expect(data.data[0]).toHaveProperty('name');
      expect(data.data[0]).toHaveProperty('request');
      expect(data.data[0]).toHaveProperty('expectedResults');
    });
  });

  describe('CORS', () => {
    it('should handle OPTIONS requests', async () => {
      const response = await fetch(`${baseUrl}/health`, {
        method: 'OPTIONS',
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('Error handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await fetch(`${baseUrl}/unknown`);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
    });

    it('should return 405 for unsupported methods', async () => {
      const response = await fetch(`${baseUrl}/health`, {
        method: 'PUT',
      });
      const data = await response.json();

      expect(response.status).toBe(405);
      expect(data.success).toBe(false);
    });

    it('should handle invalid JSON gracefully', async () => {
      const response = await fetch(`${baseUrl}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
    });
  });
});
