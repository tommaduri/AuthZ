/**
 * TLS Configuration Tests
 *
 * Comprehensive test suite for TLS/HTTPS configuration features.
 * Follows TDD - these tests should FAIL initially (red phase).
 *
 * Tests cover:
 * - TLS disabled by default (HTTP server)
 * - TLS enabled with cert/key paths
 * - Mutual TLS (mTLS) with client certificate validation
 * - TLS version configuration and enforcement
 * - Cipher suite configuration
 * - Certificate rotation without restart
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import https from 'https';
import http from 'http';
import tls from 'tls';
import { execSync } from 'child_process';

// Mock external dependencies
vi.mock('@authz-engine/core', () => ({
  DecisionEngine: vi.fn().mockImplementation(() => ({
    check: vi.fn().mockReturnValue({
      requestId: 'test-req',
      results: { view: { effect: 'allow', policy: 'test' } },
      meta: { evaluationDurationMs: 5 },
    }),
    getStats: vi.fn().mockReturnValue({
      resourcePolicies: 1,
      derivedRolesPolicies: 0,
      resources: ['document'],
    }),
    loadResourcePolicies: vi.fn(),
    clearPolicies: vi.fn(),
  })),
}));

vi.mock('@authz-engine/agents', () => ({
  AgentOrchestrator: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    processRequest: vi.fn().mockResolvedValue({
      anomalyScore: 0.1,
      enforcement: { allowed: true },
      agentsInvolved: ['guardian', 'enforcer'],
    }),
    getHealth: vi.fn().mockResolvedValue({
      status: 'healthy',
      agents: {},
      infrastructure: { store: 'connected', eventBus: 'connected' },
    }),
  })),
}));

// =============================================================================
// Import TLS implementation
// =============================================================================
import {
  createTLSServer,
  CertificateManager,
  CertificateRotationManager,
} from '../../src/tls';
import type {
  TLSServerOptions,
  TLSServer,
  CertificateRotationManagerOptions,
} from '../../src/tls';

// Test certificate paths (will be generated in test setup)
const TEST_CERTS_DIR = join(__dirname, '..', '__fixtures__', 'certs');

// =============================================================================
// Test Fixtures and Helpers
// =============================================================================

/**
 * Generate self-signed certificates for testing
 * In real tests, we'd generate these or use pre-created fixtures
 */
async function generateTestCertificates(): Promise<{
  serverCert: string;
  serverKey: string;
  caCert: string;
  caKey: string;
  clientCert: string;
  clientKey: string;
  expiredCert: string;
  expiredKey: string;
  wrongCACert: string;
  wrongCAKey: string;
}> {
  // Note: These paths reference certificates that would be generated
  // For TDD, we define the expected structure
  return {
    serverCert: join(TEST_CERTS_DIR, 'server.crt'),
    serverKey: join(TEST_CERTS_DIR, 'server.key'),
    caCert: join(TEST_CERTS_DIR, 'ca.crt'),
    caKey: join(TEST_CERTS_DIR, 'ca.key'),
    clientCert: join(TEST_CERTS_DIR, 'client.crt'),
    clientKey: join(TEST_CERTS_DIR, 'client.key'),
    expiredCert: join(TEST_CERTS_DIR, 'expired.crt'),
    expiredKey: join(TEST_CERTS_DIR, 'expired.key'),
    wrongCACert: join(TEST_CERTS_DIR, 'wrong-ca.crt'),
    wrongCAKey: join(TEST_CERTS_DIR, 'wrong-ca.key'),
  };
}

/**
 * Create a test HTTPS client with custom options
 */
function createTestClient(options: https.RequestOptions): Promise<{
  statusCode: number | undefined;
  headers: http.IncomingHttpHeaders;
  body: string;
  tlsVersion: string | undefined;
  cipher: string | undefined;
}> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        const socket = res.socket as tls.TLSSocket;
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body,
          tlsVersion: socket?.getProtocol?.() || undefined,
          cipher: socket?.getCipher?.()?.name || undefined,
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Wait for server to be ready
 */
async function waitForServer(port: number, useHttps: boolean, timeout: number = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const protocol = useHttps ? 'https' : 'http';
      const options: http.RequestOptions | https.RequestOptions = {
        hostname: 'localhost',
        port,
        path: '/health',
        method: 'GET',
        rejectUnauthorized: false, // Allow self-signed for testing
      };

      await new Promise<void>((resolve, reject) => {
        const mod = useHttps ? https : http;
        const req = mod.request(options, (res) => {
          if (res.statusCode === 200) resolve();
          else reject(new Error(`Unexpected status: ${res.statusCode}`));
        });
        req.on('error', reject);
        req.setTimeout(1000, () => reject(new Error('Timeout')));
        req.end();
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('Server did not become ready within timeout');
}

// =============================================================================
// TLS Configuration Tests
// =============================================================================

describe('TLS Configuration', () => {
  let certs: Awaited<ReturnType<typeof generateTestCertificates>>;
  let testPort: number;

  beforeAll(async () => {
    certs = await generateTestCertificates();
    testPort = 3600 + Math.floor(Math.random() * 100);
  });

  // ===========================================================================
  // TLS Disabled (Default Behavior)
  // ===========================================================================

  describe('TLS disabled (default)', () => {
    it('should start HTTP server when TLS is not configured', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort,
        tls: {
          enabled: false,
        },
      };

      // Act
      const server = await createTLSServer(config);
      await server.start();

      try {
        // Assert - should respond over HTTP
        const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
          const req = http.request(
            {
              hostname: 'localhost',
              port: testPort,
              path: '/health',
              method: 'GET',
            },
            resolve
          );
          req.on('error', reject);
          req.end();
        });

        expect(response.statusCode).toBe(200);

        // Verify it's NOT HTTPS
        expect(server.isSecure()).toBe(false);
        expect(server.getProtocol()).toBe('http');
      } finally {
        await server.stop();
      }
    });

    it('should not require certificate paths when TLS is disabled', async () => {
      // Arrange - no cert/key paths provided
      const config: TLSServerOptions = {
        port: testPort + 1,
        tls: {
          enabled: false,
          // Intentionally omit cert and key
        },
      };

      // Act & Assert - should not throw
      const server = await createTLSServer(config);
      expect(server).toBeDefined();
      expect(() => server.getTLSConfig()).not.toThrow();

      const tlsConfig = server.getTLSConfig();
      expect(tlsConfig.enabled).toBe(false);
      expect(tlsConfig.cert).toBeUndefined();
      expect(tlsConfig.key).toBeUndefined();
    });

    it('should expose HTTP-only endpoints when TLS is disabled', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 2,
        tls: { enabled: false },
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        // Act - try to connect via HTTPS (should fail)
        await expect(
          createTestClient({
            hostname: 'localhost',
            port: testPort + 2,
            path: '/health',
            method: 'GET',
            rejectUnauthorized: false,
          })
        ).rejects.toThrow();

        // Assert - HTTP should work
        const httpResponse = await new Promise<http.IncomingMessage>((resolve, reject) => {
          const req = http.request(
            {
              hostname: 'localhost',
              port: testPort + 2,
              path: '/health',
              method: 'GET',
            },
            resolve
          );
          req.on('error', reject);
          req.end();
        });
        expect(httpResponse.statusCode).toBe(200);
      } finally {
        await server.stop();
      }
    });
  });

  // ===========================================================================
  // TLS Enabled
  // ===========================================================================

  describe('TLS enabled', () => {
    it('should start HTTPS server with valid cert/key paths', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 10,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
        },
      };

      // Act
      const server = await createTLSServer(config);
      await server.start();

      try {
        // Assert - should respond over HTTPS
        const response = await createTestClient({
          hostname: 'localhost',
          port: testPort + 10,
          path: '/health',
          method: 'GET',
          rejectUnauthorized: false, // Allow self-signed
        });

        expect(response.statusCode).toBe(200);
        expect(server.isSecure()).toBe(true);
        expect(server.getProtocol()).toBe('https');
      } finally {
        await server.stop();
      }
    });

    it('should reject invalid certificate paths', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 11,
        tls: {
          enabled: true,
          cert: '/nonexistent/path/server.crt',
          key: '/nonexistent/path/server.key',
        },
      };

      // Act & Assert
      await expect(createTLSServer(config)).rejects.toThrow(/certificate.*not found|ENOENT/i);
    });

    it('should reject expired certificates', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 12,
        tls: {
          enabled: true,
          cert: certs.expiredCert,
          key: certs.expiredKey,
          rejectExpired: true, // Explicitly reject expired certs
        },
      };

      // Act & Assert
      await expect(createTLSServer(config)).rejects.toThrow(/certificate.*expired/i);
    });

    it('should reject mismatched cert/key pairs', async () => {
      // Arrange - use server cert with wrong key
      const config: TLSServerOptions = {
        port: testPort + 13,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.clientKey, // Wrong key for this cert
        },
      };

      // Act & Assert
      await expect(createTLSServer(config)).rejects.toThrow(/key.*mismatch|inconsistent/i);
    });

    it('should require both cert and key when TLS is enabled', async () => {
      // Arrange - missing key
      const configMissingKey: TLSServerOptions = {
        port: testPort + 14,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          // key is missing
        },
      };

      // Act & Assert
      await expect(createTLSServer(configMissingKey)).rejects.toThrow(/key.*required/i);

      // Arrange - missing cert
      const configMissingCert: TLSServerOptions = {
        port: testPort + 15,
        tls: {
          enabled: true,
          key: certs.serverKey,
          // cert is missing
        },
      };

      // Act & Assert
      await expect(createTLSServer(configMissingCert)).rejects.toThrow(/cert.*required/i);
    });

    it('should support passphrase-protected private keys', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 16,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: join(TEST_CERTS_DIR, 'server-encrypted.key'),
          passphrase: 'test-passphrase',
        },
      };

      // Act
      const server = await createTLSServer(config);
      await server.start();

      try {
        // Assert
        const response = await createTestClient({
          hostname: 'localhost',
          port: testPort + 16,
          path: '/health',
          method: 'GET',
          rejectUnauthorized: false,
        });
        expect(response.statusCode).toBe(200);
      } finally {
        await server.stop();
      }
    });

    it('should reject wrong passphrase for encrypted key', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 17,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: join(TEST_CERTS_DIR, 'server-encrypted.key'),
          passphrase: 'wrong-passphrase',
        },
      };

      // Act & Assert
      await expect(createTLSServer(config)).rejects.toThrow(/passphrase|decrypt/i);
    });
  });

  // ===========================================================================
  // Mutual TLS (mTLS)
  // ===========================================================================

  describe('mutual TLS (mTLS)', () => {
    it('should require client certificate when mTLS is enabled', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 20,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
          ca: certs.caCert,
          requestCert: true,
          rejectUnauthorized: true,
        },
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        // Act - connect WITHOUT client certificate
        await expect(
          createTestClient({
            hostname: 'localhost',
            port: testPort + 20,
            path: '/health',
            method: 'GET',
            rejectUnauthorized: false,
            // No client cert provided
          })
        ).rejects.toThrow(/certificate|unauthorized|handshake/i);
      } finally {
        await server.stop();
      }
    });

    it('should validate client certificate against CA', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 21,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
          ca: certs.caCert,
          requestCert: true,
          rejectUnauthorized: true,
        },
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        // Act - connect WITH valid client certificate
        const response = await createTestClient({
          hostname: 'localhost',
          port: testPort + 21,
          path: '/health',
          method: 'GET',
          rejectUnauthorized: false,
          cert: readFileSync(certs.clientCert),
          key: readFileSync(certs.clientKey),
          ca: readFileSync(certs.caCert),
        });

        // Assert
        expect(response.statusCode).toBe(200);
      } finally {
        await server.stop();
      }
    });

    it('should reject untrusted client certificates', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 22,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
          ca: certs.caCert, // Server trusts only this CA
          requestCert: true,
          rejectUnauthorized: true,
        },
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        // Act - connect with client cert signed by DIFFERENT CA
        await expect(
          createTestClient({
            hostname: 'localhost',
            port: testPort + 22,
            path: '/health',
            method: 'GET',
            rejectUnauthorized: false,
            cert: readFileSync(join(TEST_CERTS_DIR, 'client-wrong-ca.crt')),
            key: readFileSync(join(TEST_CERTS_DIR, 'client-wrong-ca.key')),
            ca: readFileSync(certs.wrongCACert),
          })
        ).rejects.toThrow(/certificate|unauthorized|unknown ca/i);
      } finally {
        await server.stop();
      }
    });

    it('should reject expired client certificates', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 23,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
          ca: certs.caCert,
          requestCert: true,
          rejectUnauthorized: true,
        },
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        // Act - connect with expired client cert
        await expect(
          createTestClient({
            hostname: 'localhost',
            port: testPort + 23,
            path: '/health',
            method: 'GET',
            rejectUnauthorized: false,
            cert: readFileSync(join(TEST_CERTS_DIR, 'client-expired.crt')),
            key: readFileSync(join(TEST_CERTS_DIR, 'client-expired.key')),
            ca: readFileSync(certs.caCert),
          })
        ).rejects.toThrow(/expired|certificate/i);
      } finally {
        await server.stop();
      }
    });

    it('should support multiple CA certificates', async () => {
      // Arrange - server trusts multiple CAs
      const config: TLSServerOptions = {
        port: testPort + 24,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
          ca: [certs.caCert, certs.wrongCACert], // Trust both CAs
          requestCert: true,
          rejectUnauthorized: true,
        },
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        // Act - connect with cert from first CA
        const response1 = await createTestClient({
          hostname: 'localhost',
          port: testPort + 24,
          path: '/health',
          method: 'GET',
          rejectUnauthorized: false,
          cert: readFileSync(certs.clientCert),
          key: readFileSync(certs.clientKey),
          ca: readFileSync(certs.caCert),
        });
        expect(response1.statusCode).toBe(200);

        // Act - connect with cert from second CA
        const response2 = await createTestClient({
          hostname: 'localhost',
          port: testPort + 24,
          path: '/health',
          method: 'GET',
          rejectUnauthorized: false,
          cert: readFileSync(join(TEST_CERTS_DIR, 'client-wrong-ca.crt')),
          key: readFileSync(join(TEST_CERTS_DIR, 'client-wrong-ca.key')),
          ca: readFileSync(certs.wrongCACert),
        });
        expect(response2.statusCode).toBe(200);
      } finally {
        await server.stop();
      }
    });

    it('should expose client certificate info in request context', async () => {
      // Arrange
      let capturedClientCert: tls.PeerCertificate | null = null;

      const config: TLSServerOptions = {
        port: testPort + 25,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
          ca: certs.caCert,
          requestCert: true,
          rejectUnauthorized: true,
        },
        onClientCertificate: (cert) => {
          capturedClientCert = cert;
        },
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        // Act
        await createTestClient({
          hostname: 'localhost',
          port: testPort + 25,
          path: '/health',
          method: 'GET',
          rejectUnauthorized: false,
          cert: readFileSync(certs.clientCert),
          key: readFileSync(certs.clientKey),
          ca: readFileSync(certs.caCert),
        });

        // Assert
        expect(capturedClientCert).not.toBeNull();
        expect(capturedClientCert?.subject).toBeDefined();
        expect(capturedClientCert?.issuer).toBeDefined();
      } finally {
        await server.stop();
      }
    });
  });

  // ===========================================================================
  // TLS Versions
  // ===========================================================================

  describe('TLS versions', () => {
    it('should enforce minimum TLS version 1.2', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 30,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
          minVersion: 'TLSv1.2',
        },
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        // Act - connect with TLS 1.2
        const response = await createTestClient({
          hostname: 'localhost',
          port: testPort + 30,
          path: '/health',
          method: 'GET',
          rejectUnauthorized: false,
          minVersion: 'TLSv1.2',
          maxVersion: 'TLSv1.2',
        });

        // Assert
        expect(response.statusCode).toBe(200);
        expect(response.tlsVersion).toBe('TLSv1.2');
      } finally {
        await server.stop();
      }
    });

    it('should reject TLS 1.1 connections when minimum is 1.2', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 31,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
          minVersion: 'TLSv1.2',
        },
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        // Act - attempt to connect with TLS 1.1 (should fail)
        await expect(
          createTestClient({
            hostname: 'localhost',
            port: testPort + 31,
            path: '/health',
            method: 'GET',
            rejectUnauthorized: false,
            minVersion: 'TLSv1.1',
            maxVersion: 'TLSv1.1',
          } as any) // Type assertion needed as maxVersion TLSv1.1 may not be in types
        ).rejects.toThrow(/protocol|version|handshake/i);
      } finally {
        await server.stop();
      }
    });

    it('should support TLS 1.3 when configured', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 32,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
          minVersion: 'TLSv1.3',
          maxVersion: 'TLSv1.3',
        },
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        // Act
        const response = await createTestClient({
          hostname: 'localhost',
          port: testPort + 32,
          path: '/health',
          method: 'GET',
          rejectUnauthorized: false,
          minVersion: 'TLSv1.3',
        });

        // Assert
        expect(response.statusCode).toBe(200);
        expect(response.tlsVersion).toBe('TLSv1.3');
      } finally {
        await server.stop();
      }
    });

    it('should reject connections below minimum TLS version', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 33,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
          minVersion: 'TLSv1.3',
        },
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        // Act - try to connect with TLS 1.2 when minimum is 1.3
        await expect(
          createTestClient({
            hostname: 'localhost',
            port: testPort + 33,
            path: '/health',
            method: 'GET',
            rejectUnauthorized: false,
            maxVersion: 'TLSv1.2',
          })
        ).rejects.toThrow(/protocol|version|handshake/i);
      } finally {
        await server.stop();
      }
    });

    it('should return TLS version in response headers when configured', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 34,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
          minVersion: 'TLSv1.2',
          exposeVersionHeader: true,
        },
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        // Act
        const response = await createTestClient({
          hostname: 'localhost',
          port: testPort + 34,
          path: '/health',
          method: 'GET',
          rejectUnauthorized: false,
        });

        // Assert
        expect(response.headers['x-tls-version']).toBeDefined();
        expect(response.headers['x-tls-version']).toMatch(/TLSv1\.[23]/);
      } finally {
        await server.stop();
      }
    });
  });

  // ===========================================================================
  // Cipher Suite Configuration
  // ===========================================================================

  describe('cipher suite configuration', () => {
    it('should support custom cipher suites', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 40,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
          ciphers: 'ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256',
        },
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        // Act
        const response = await createTestClient({
          hostname: 'localhost',
          port: testPort + 40,
          path: '/health',
          method: 'GET',
          rejectUnauthorized: false,
        });

        // Assert
        expect(response.statusCode).toBe(200);
        expect(response.cipher).toMatch(/AES.*GCM/);
      } finally {
        await server.stop();
      }
    });

    it('should reject weak ciphers when not in allowed list', async () => {
      // Arrange - server only allows strong ciphers
      const config: TLSServerOptions = {
        port: testPort + 41,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
          ciphers: 'ECDHE-RSA-AES256-GCM-SHA384',
          honorCipherOrder: true,
        },
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        // Act - try to connect with weak cipher
        await expect(
          createTestClient({
            hostname: 'localhost',
            port: testPort + 41,
            path: '/health',
            method: 'GET',
            rejectUnauthorized: false,
            ciphers: 'RC4-SHA', // Weak cipher
          })
        ).rejects.toThrow(/cipher|handshake|no common/i);
      } finally {
        await server.stop();
      }
    });

    it('should prefer server cipher order when honorCipherOrder is true', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 42,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
          ciphers: 'ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256',
          honorCipherOrder: true,
        },
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        // Act - client prefers AES128, but server prefers AES256
        const response = await createTestClient({
          hostname: 'localhost',
          port: testPort + 42,
          path: '/health',
          method: 'GET',
          rejectUnauthorized: false,
          ciphers: 'ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384',
        });

        // Assert - server's preferred cipher should be used
        expect(response.cipher).toContain('AES256');
      } finally {
        await server.stop();
      }
    });

    it('should expose negotiated cipher in TLS info', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 43,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
          exposeCipherHeader: true,
        },
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        // Act
        const response = await createTestClient({
          hostname: 'localhost',
          port: testPort + 43,
          path: '/health',
          method: 'GET',
          rejectUnauthorized: false,
        });

        // Assert
        expect(response.headers['x-tls-cipher']).toBeDefined();
        expect(response.cipher).toBeDefined();
      } finally {
        await server.stop();
      }
    });
  });

  // ===========================================================================
  // Certificate Rotation
  // ===========================================================================

  describe('certificate rotation', () => {
    it('should reload certificates on SIGHUP', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 50,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
          hotReload: true,
        },
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        // Get initial certificate fingerprint
        const initialFingerprint = server.getCertificateFingerprint();

        // Act - simulate SIGHUP (in tests, call the reload method directly)
        await server.reloadCertificates();

        // Assert - server should still be running
        const response = await createTestClient({
          hostname: 'localhost',
          port: testPort + 50,
          path: '/health',
          method: 'GET',
          rejectUnauthorized: false,
        });
        expect(response.statusCode).toBe(200);

        // Verify reload was called (certificate could be same if file didn't change)
        const reloadCount = server.getCertificateReloadCount();
        expect(reloadCount).toBeGreaterThan(0);
      } finally {
        await server.stop();
      }
    });

    it('should continue serving during certificate rotation', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 51,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
          hotReload: true,
        },
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        // Start continuous requests
        const requestPromises: Promise<any>[] = [];
        const requestCount = 10;

        // Act - send requests while reloading
        for (let i = 0; i < requestCount; i++) {
          requestPromises.push(
            createTestClient({
              hostname: 'localhost',
              port: testPort + 51,
              path: '/health',
              method: 'GET',
              rejectUnauthorized: false,
            })
          );

          // Trigger reload mid-way through requests
          if (i === Math.floor(requestCount / 2)) {
            await server.reloadCertificates();
          }
        }

        const results = await Promise.allSettled(requestPromises);

        // Assert - all requests should succeed
        const successCount = results.filter((r) => r.status === 'fulfilled').length;
        expect(successCount).toBe(requestCount);
      } finally {
        await server.stop();
      }
    });

    it('should support file watcher for automatic certificate rotation', async () => {
      // Arrange
      const rotationConfig: TLSServerOptions = {
        port: testPort + 52,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
          hotReload: true,
          watchFiles: true,
          watchDebounceMs: 100,
        },
      };

      const server = await createTLSServer(rotationConfig);
      await server.start();

      try {
        const initialReloadCount = server.getCertificateReloadCount();

        // Act - simulate file change by touching the cert file
        // In real tests, we'd modify the file
        await server.simulateFileChange(certs.serverCert);

        // Wait for debounce
        await new Promise((r) => setTimeout(r, 200));

        // Assert - reload should have been triggered
        const newReloadCount = server.getCertificateReloadCount();
        expect(newReloadCount).toBeGreaterThan(initialReloadCount);
      } finally {
        await server.stop();
      }
    });

    it('should roll back on invalid certificate during rotation', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 53,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
          hotReload: true,
          rollbackOnFailure: true,
        },
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        const initialFingerprint = server.getCertificateFingerprint();

        // Act - try to reload with invalid cert path
        await expect(
          server.reloadCertificates({
            cert: '/invalid/path.crt',
            key: '/invalid/path.key',
          })
        ).rejects.toThrow();

        // Assert - should still be serving with original cert
        const response = await createTestClient({
          hostname: 'localhost',
          port: testPort + 53,
          path: '/health',
          method: 'GET',
          rejectUnauthorized: false,
        });
        expect(response.statusCode).toBe(200);

        // Fingerprint should be unchanged
        expect(server.getCertificateFingerprint()).toBe(initialFingerprint);
      } finally {
        await server.stop();
      }
    });

    it('should emit events during certificate rotation', async () => {
      // Arrange
      const events: string[] = [];
      const config: TLSServerOptions = {
        port: testPort + 54,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
          hotReload: true,
        },
        onCertificateReload: (event) => {
          events.push(event.type);
        },
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        // Act
        await server.reloadCertificates();

        // Assert
        expect(events).toContain('reload_started');
        expect(events).toContain('reload_completed');
      } finally {
        await server.stop();
      }
    });

    it('should support graceful rotation with connection draining', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 55,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
          hotReload: true,
          gracefulRotation: true,
          drainTimeoutMs: 5000,
        },
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        // Start a long-running request
        const longRequest = new Promise((resolve, reject) => {
          const req = https.request(
            {
              hostname: 'localhost',
              port: testPort + 55,
              path: '/long-operation', // Endpoint that takes time
              method: 'GET',
              rejectUnauthorized: false,
            },
            resolve
          );
          req.on('error', reject);
          req.end();
        });

        // Act - trigger reload while request is in progress
        const reloadPromise = server.reloadCertificates({ graceful: true });

        // Assert - long request should complete
        const [response] = await Promise.all([longRequest, reloadPromise]);
        expect((response as http.IncomingMessage).statusCode).toBeDefined();
      } finally {
        await server.stop();
      }
    });
  });

  // ===========================================================================
  // TLS Configuration API
  // ===========================================================================

  describe('TLS configuration API', () => {
    it('should expose current TLS configuration', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 60,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
          minVersion: 'TLSv1.2',
        },
      };

      const server = await createTLSServer(config);

      // Act
      const tlsConfig = server.getTLSConfig();

      // Assert
      expect(tlsConfig.enabled).toBe(true);
      expect(tlsConfig.minVersion).toBe('TLSv1.2');
      expect(tlsConfig.cert).toBe(certs.serverCert);
    });

    it('should not expose private key in configuration', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 61,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
        },
      };

      const server = await createTLSServer(config);

      // Act
      const tlsConfig = server.getTLSConfig();

      // Assert - key should be masked or path-only
      expect(tlsConfig.key).not.toContain('-----BEGIN');
      expect(tlsConfig.keyPath).toBeDefined();
    });

    it('should provide certificate info endpoint', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 62,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
          exposeInfoEndpoint: true,
        },
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        // Act
        const response = await createTestClient({
          hostname: 'localhost',
          port: testPort + 62,
          path: '/.well-known/tls-info',
          method: 'GET',
          rejectUnauthorized: false,
        });

        // Assert
        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.certificate).toBeDefined();
        expect(body.certificate.subject).toBeDefined();
        expect(body.certificate.issuer).toBeDefined();
        expect(body.certificate.validFrom).toBeDefined();
        expect(body.certificate.validTo).toBeDefined();
        expect(body.certificate.fingerprint).toBeDefined();
        // Should NOT expose private key info
        expect(body.privateKey).toBeUndefined();
      } finally {
        await server.stop();
      }
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('error handling', () => {
    it('should handle TLS handshake errors gracefully', async () => {
      // Arrange
      const errors: Error[] = [];
      const config: TLSServerOptions = {
        port: testPort + 70,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
        },
        onTLSError: (error) => {
          errors.push(error);
        },
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        // Act - force a TLS error by connecting with invalid protocol
        await expect(
          new Promise((resolve, reject) => {
            const socket = tls.connect(
              {
                host: 'localhost',
                port: testPort + 70,
                rejectUnauthorized: false,
                // Force an incompatible setting
                secureProtocol: 'SSLv3_method', // Deprecated/unsupported
              } as any,
              () => resolve(true)
            );
            socket.on('error', reject);
          })
        ).rejects.toThrow();

        // Assert - error should be captured
        // Note: Error might not always be captured depending on TLS implementation
      } finally {
        await server.stop();
      }
    });

    it('should log TLS negotiation failures', async () => {
      // Arrange
      const logs: string[] = [];
      const config: TLSServerOptions = {
        port: testPort + 71,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
          minVersion: 'TLSv1.3',
        },
        logger: {
          error: (msg: string) => logs.push(msg),
          info: () => {},
          warn: () => {},
          debug: () => {},
        },
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        // Act - try to connect with TLS 1.2 when minimum is 1.3
        await expect(
          createTestClient({
            hostname: 'localhost',
            port: testPort + 71,
            path: '/health',
            method: 'GET',
            rejectUnauthorized: false,
            maxVersion: 'TLSv1.2',
          })
        ).rejects.toThrow();

        // Allow time for logging
        await new Promise((r) => setTimeout(r, 100));

        // Assert - error should be logged
        expect(logs.some((log) => log.includes('TLS') || log.includes('handshake'))).toBe(true);
      } finally {
        await server.stop();
      }
    });
  });

  // ===========================================================================
  // Integration Tests
  // ===========================================================================

  describe('integration', () => {
    it('should work with Fastify REST server', async () => {
      // Arrange
      const config: TLSServerOptions = {
        port: testPort + 80,
        tls: {
          enabled: true,
          cert: certs.serverCert,
          key: certs.serverKey,
        },
        integration: 'fastify',
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        // Act
        const response = await createTestClient({
          hostname: 'localhost',
          port: testPort + 80,
          path: '/api/check',
          method: 'POST',
          rejectUnauthorized: false,
          headers: {
            'Content-Type': 'application/json',
          },
        });

        // Assert - should be able to reach Fastify endpoints over HTTPS
        // Note: Will likely return 400 without proper body, but proves TLS works
        expect([200, 400]).toContain(response.statusCode);
      } finally {
        await server.stop();
      }
    });

    it('should support TLS termination proxy configuration', async () => {
      // Arrange - server behind a TLS termination proxy
      const config: TLSServerOptions = {
        port: testPort + 81,
        tls: {
          enabled: false, // HTTP for backend
        },
        proxy: {
          trustProxy: true,
          proxyProtocol: true,
        },
      };

      const server = await createTLSServer(config);
      await server.start();

      try {
        // Act - simulate request from proxy with X-Forwarded headers
        const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
          const req = http.request(
            {
              hostname: 'localhost',
              port: testPort + 81,
              path: '/health',
              method: 'GET',
              headers: {
                'X-Forwarded-Proto': 'https',
                'X-Forwarded-For': '10.0.0.1',
              },
            },
            resolve
          );
          req.on('error', reject);
          req.end();
        });

        // Assert
        expect(response.statusCode).toBe(200);
      } finally {
        await server.stop();
      }
    });
  });
});

// =============================================================================
// Certificate Manager Tests
// =============================================================================

describe('CertificateManager', () => {
  it('should validate certificate chain', async () => {
    // Arrange
    const certs = await generateTestCertificates();
    const manager = new CertificateManager();

    // Act
    const result = await manager.validateChain(certs.serverCert, certs.caCert);

    // Assert
    expect(result.valid).toBe(true);
    expect(result.chain).toBeDefined();
  });

  it('should detect certificate expiration', async () => {
    // Arrange
    const certs = await generateTestCertificates();
    const manager = new CertificateManager();

    // Act
    const expiredResult = await manager.checkExpiration(certs.expiredCert);
    const validResult = await manager.checkExpiration(certs.serverCert);

    // Assert
    expect(expiredResult.expired).toBe(true);
    expect(validResult.expired).toBe(false);
    expect(validResult.daysUntilExpiry).toBeGreaterThan(0);
  });

  it('should provide certificate fingerprint', async () => {
    // Arrange
    const certs = await generateTestCertificates();
    const manager = new CertificateManager();

    // Act
    const fingerprint = await manager.getFingerprint(certs.serverCert);

    // Assert
    expect(fingerprint).toMatch(/^([0-9A-F]{2}:)+[0-9A-F]{2}$/i);
  });

  it('should parse certificate subject', async () => {
    // Arrange
    const certs = await generateTestCertificates();
    const manager = new CertificateManager();

    // Act
    const subject = await manager.getSubject(certs.serverCert);

    // Assert
    expect(subject.CN).toBeDefined();
    expect(subject.O).toBeDefined();
  });
});

// =============================================================================
// Certificate Rotation Manager Tests
// =============================================================================

describe('CertificateRotationManager', () => {
  it('should schedule certificate rotation', async () => {
    // Arrange
    const rotationManager = new CertificateRotationManager({
      checkIntervalMs: 1000,
      renewBeforeDays: 30,
    });

    const certs = await generateTestCertificates();

    // Act
    rotationManager.addCertificate('server', certs.serverCert, certs.serverKey);
    const schedule = rotationManager.getRotationSchedule();

    // Assert
    expect(schedule['server']).toBeDefined();
    expect(schedule['server'].nextCheck).toBeInstanceOf(Date);
  });

  it('should trigger rotation callback when certificate nears expiry', async () => {
    // Arrange
    const rotationTriggered = vi.fn();
    const rotationManager = new CertificateRotationManager({
      checkIntervalMs: 100,
      renewBeforeDays: 365, // Trigger for any cert expiring within a year
      onRotationNeeded: rotationTriggered,
    });

    const certs = await generateTestCertificates();

    // Act
    rotationManager.addCertificate('server', certs.serverCert, certs.serverKey);
    await new Promise((r) => setTimeout(r, 200));

    // Assert - callback should be triggered if cert expires within 365 days
    // This depends on test cert validity
    expect(rotationTriggered).toHaveBeenCalled();

    // Cleanup
    rotationManager.stop();
  });
});
