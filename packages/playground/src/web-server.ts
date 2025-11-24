/**
 * Web Server for Policy Playground
 *
 * Provides an HTTP API for web-based policy testing and simulation.
 *
 * @module @authz-engine/playground/web-server
 */

import * as http from 'http';
import { PolicySimulator } from './simulator.js';
import type { CheckRequest } from '@authz-engine/core';

/**
 * Web Server Configuration
 */
export interface WebServerConfig {
  /** Port to listen on (default: 3001) */
  port?: number;
  /** Host to bind to (default: localhost) */
  host?: string;
  /** Enable CORS (default: true) */
  cors?: boolean;
  /** Request body size limit in bytes (default: 1MB) */
  bodyLimit?: number;
}

/**
 * API Response wrapper
 */
interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

/**
 * Example policy for the examples endpoint
 */
interface ExamplePolicy {
  name: string;
  description: string;
  yaml: string;
  sampleRequests: Array<{
    description: string;
    request: CheckRequest;
  }>;
}

/**
 * Policy Playground Web Server
 */
export class PlaygroundWebServer {
  private readonly simulator: PolicySimulator;
  private readonly config: Required<WebServerConfig>;
  private server?: http.Server;

  constructor(config: WebServerConfig = {}) {
    this.simulator = new PolicySimulator({ verbose: true });
    this.config = {
      port: config.port ?? 3001,
      host: config.host ?? 'localhost',
      cors: config.cors ?? true,
      bodyLimit: config.bodyLimit ?? 1024 * 1024, // 1MB
    };
  }

  /**
   * Start the web server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(this.handleRequest.bind(this));

      this.server.on('error', (error) => {
        reject(error);
      });

      this.server.listen(this.config.port, this.config.host, () => {
        console.log(
          `Playground server running at http://${this.config.host}:${this.config.port}`
        );
        console.log(`
Available endpoints:
  POST /simulate  - Run policy simulation
  POST /explain   - Get detailed explanation
  POST /whatif    - Test what-if scenarios
  POST /rules     - Find matching rules
  POST /tests     - Generate test cases
  POST /load      - Load policies
  GET  /examples  - Get example policies
  GET  /stats     - Get simulator statistics
  GET  /health    - Health check
`);
        resolve();
      });
    });
  }

  /**
   * Stop the web server
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((error) => {
        if (error) {
          reject(error);
        } else {
          this.server = undefined;
          resolve();
        }
      });
    });
  }

  /**
   * Handle incoming HTTP requests
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // Set CORS headers if enabled
    if (this.config.cors) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
    }

    res.setHeader('Content-Type', 'application/json');

    try {
      const url = new URL(req.url ?? '/', `http://${this.config.host}`);
      const path = url.pathname;

      // Route requests
      if (req.method === 'GET') {
        switch (path) {
          case '/examples':
            this.handleExamples(res);
            return;
          case '/stats':
            this.handleStats(res);
            return;
          case '/health':
            this.handleHealth(res);
            return;
          default:
            this.sendError(res, 404, `Not found: ${path}`);
            return;
        }
      }

      if (req.method === 'POST') {
        const body = await this.readBody(req);

        switch (path) {
          case '/simulate':
            await this.handleSimulate(body, res);
            return;
          case '/explain':
            await this.handleExplain(body, res);
            return;
          case '/whatif':
            await this.handleWhatIf(body, res);
            return;
          case '/rules':
            await this.handleRules(body, res);
            return;
          case '/tests':
            await this.handleTests(body, res);
            return;
          case '/load':
            await this.handleLoad(body, res);
            return;
          default:
            this.sendError(res, 404, `Not found: ${path}`);
            return;
        }
      }

      this.sendError(res, 405, `Method not allowed: ${req.method}`);
    } catch (error) {
      this.sendError(
        res,
        500,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Read request body
   */
  private readBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;

      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > this.config.bodyLimit) {
          reject(new Error('Request body too large'));
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        if (!body) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('Invalid JSON in request body'));
        }
      });

      req.on('error', reject);
    });
  }

  /**
   * Send success response
   */
  private sendSuccess<T>(res: http.ServerResponse, data: T): void {
    const response: ApiResponse<T> = {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    };
    res.writeHead(200);
    res.end(JSON.stringify(response, null, 2));
  }

  /**
   * Send error response
   */
  private sendError(res: http.ServerResponse, status: number, message: string): void {
    const response: ApiResponse = {
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    };
    res.writeHead(status);
    res.end(JSON.stringify(response, null, 2));
  }

  /**
   * Handle POST /simulate
   */
  private async handleSimulate(body: unknown, res: http.ServerResponse): Promise<void> {
    const data = body as {
      policy?: string;
      request: CheckRequest;
    };

    if (!data.request) {
      this.sendError(res, 400, 'Missing required field: request');
      return;
    }

    // Load policy if provided
    if (data.policy) {
      this.simulator.clearPolicies();
      this.simulator.loadPolicies(data.policy);
    }

    const response = this.simulator.simulate(data.request);
    this.sendSuccess(res, response);
  }

  /**
   * Handle POST /explain
   */
  private async handleExplain(body: unknown, res: http.ServerResponse): Promise<void> {
    const data = body as {
      policy?: string;
      request?: CheckRequest;
    };

    // Load policy if provided
    if (data.policy) {
      this.simulator.clearPolicies();
      this.simulator.loadPolicies(data.policy);
    }

    // Simulate if request provided
    if (data.request) {
      this.simulator.simulate(data.request);
    }

    const explanation = this.simulator.explain(data.request);
    this.sendSuccess(res, explanation);
  }

  /**
   * Handle POST /whatif
   */
  private async handleWhatIf(body: unknown, res: http.ServerResponse): Promise<void> {
    const data = body as {
      policy?: string;
      baseRequest?: CheckRequest;
      changes: {
        principal?: { id?: string; roles?: string[]; attributes?: Record<string, unknown> };
        resource?: { kind?: string; id?: string; attributes?: Record<string, unknown> };
        actions?: string[];
        auxData?: Record<string, unknown>;
      };
    };

    if (!data.changes) {
      this.sendError(res, 400, 'Missing required field: changes');
      return;
    }

    // Load policy if provided
    if (data.policy) {
      this.simulator.clearPolicies();
      this.simulator.loadPolicies(data.policy);
    }

    // Run base request if provided
    if (data.baseRequest) {
      this.simulator.simulate(data.baseRequest);
    }

    const result = this.simulator.whatIf(data.changes);
    this.sendSuccess(res, result);
  }

  /**
   * Handle POST /rules
   */
  private async handleRules(body: unknown, res: http.ServerResponse): Promise<void> {
    const data = body as {
      policy?: string;
      request?: CheckRequest;
    };

    // Load policy if provided
    if (data.policy) {
      this.simulator.clearPolicies();
      this.simulator.loadPolicies(data.policy);
    }

    // Simulate if request provided
    if (data.request) {
      this.simulator.simulate(data.request);
    }

    const rules = this.simulator.findMatchingRules(data.request);
    this.sendSuccess(res, rules);
  }

  /**
   * Handle POST /tests
   */
  private async handleTests(body: unknown, res: http.ServerResponse): Promise<void> {
    const data = body as {
      policy?: string;
    };

    // Load policy if provided
    if (data.policy) {
      this.simulator.clearPolicies();
      this.simulator.loadPolicies(data.policy);
    }

    const tests = this.simulator.generateTestCases();
    this.sendSuccess(res, tests);
  }

  /**
   * Handle POST /load
   */
  private async handleLoad(body: unknown, res: http.ServerResponse): Promise<void> {
    const data = body as {
      policy: string;
      clear?: boolean;
    };

    if (!data.policy) {
      this.sendError(res, 400, 'Missing required field: policy');
      return;
    }

    if (data.clear !== false) {
      this.simulator.clearPolicies();
    }

    const results = this.simulator.loadPolicies(data.policy);
    this.sendSuccess(res, {
      loaded: results,
      stats: this.simulator.getStats(),
    });
  }

  /**
   * Handle GET /examples
   */
  private handleExamples(res: http.ServerResponse): void {
    const examples: ExamplePolicy[] = [
      {
        name: 'Simple RBAC',
        description: 'Basic role-based access control for documents',
        yaml: `apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy
spec:
  resource: document
  rules:
    - name: admin-full-access
      actions: ["*"]
      effect: allow
      roles: ["admin"]

    - name: editor-write
      actions: ["read", "update"]
      effect: allow
      roles: ["editor"]

    - name: viewer-read
      actions: ["read"]
      effect: allow
      roles: ["viewer"]`,
        sampleRequests: [
          {
            description: 'Admin can delete',
            request: {
              principal: { id: 'admin1', roles: ['admin'], attributes: {} },
              resource: { kind: 'document', id: 'doc1', attributes: {} },
              actions: ['delete'],
            },
          },
          {
            description: 'Viewer can only read',
            request: {
              principal: { id: 'user1', roles: ['viewer'], attributes: {} },
              resource: { kind: 'document', id: 'doc1', attributes: {} },
              actions: ['read', 'update'],
            },
          },
        ],
      },
      {
        name: 'Ownership-based Access',
        description: 'Access control with resource ownership conditions',
        yaml: `apiVersion: authz.engine/v1
kind: DerivedRoles
metadata:
  name: ownership-roles
spec:
  definitions:
    - name: owner
      parentRoles: ["user"]
      condition:
        expression: "resource.ownerId == principal.id"
---
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: owned-resource-policy
spec:
  resource: document
  rules:
    - name: owner-full-access
      actions: ["*"]
      effect: allow
      derivedRoles: ["owner"]

    - name: public-read
      actions: ["read"]
      effect: allow
      roles: ["user"]
      condition:
        expression: "resource.public == true"`,
        sampleRequests: [
          {
            description: 'Owner can edit their document',
            request: {
              principal: { id: 'user1', roles: ['user'], attributes: {} },
              resource: { kind: 'document', id: 'doc1', attributes: { ownerId: 'user1' } },
              actions: ['update', 'delete'],
            },
          },
          {
            description: 'Non-owner cannot edit',
            request: {
              principal: { id: 'user2', roles: ['user'], attributes: {} },
              resource: { kind: 'document', id: 'doc1', attributes: { ownerId: 'user1' } },
              actions: ['update'],
            },
          },
        ],
      },
      {
        name: 'Hierarchical Organization',
        description: 'Department-based access with hierarchy',
        yaml: `apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: department-policy
spec:
  resource: report
  rules:
    - name: department-access
      actions: ["read"]
      effect: allow
      roles: ["employee"]
      condition:
        expression: "principal.department == resource.department"

    - name: manager-cross-department
      actions: ["read"]
      effect: allow
      roles: ["manager"]

    - name: executive-full
      actions: ["*"]
      effect: allow
      roles: ["executive"]`,
        sampleRequests: [
          {
            description: 'Employee can read own department reports',
            request: {
              principal: { id: 'emp1', roles: ['employee'], attributes: { department: 'engineering' } },
              resource: { kind: 'report', id: 'r1', attributes: { department: 'engineering' } },
              actions: ['read'],
            },
          },
          {
            description: 'Employee cannot read other department reports',
            request: {
              principal: { id: 'emp1', roles: ['employee'], attributes: { department: 'engineering' } },
              resource: { kind: 'report', id: 'r2', attributes: { department: 'finance' } },
              actions: ['read'],
            },
          },
        ],
      },
    ];

    this.sendSuccess(res, examples);
  }

  /**
   * Handle GET /stats
   */
  private handleStats(res: http.ServerResponse): void {
    const stats = this.simulator.getStats();
    this.sendSuccess(res, stats);
  }

  /**
   * Handle GET /health
   */
  private handleHealth(res: http.ServerResponse): void {
    this.sendSuccess(res, {
      status: 'healthy',
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    });
  }
}

export { PlaygroundWebServer as default };
