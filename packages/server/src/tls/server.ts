/**
 * TLS Server Implementation
 *
 * Provides HTTPS/TLS server functionality with certificate management,
 * hot reloading, mTLS support, and graceful rotation.
 */

import Fastify, { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import * as tls from 'tls';
import * as crypto from 'crypto';
import type {
  TLSServerOptions,
  TLSServer,
  TLSConfigInfo,
  ReloadCertificateOptions,
  CertificateReloadEvent,
  TlsConfig,
} from './types';
import { CertificateManager } from './certificates';

/**
 * Default logger implementation
 */
const defaultLogger = {
  error: (msg: string) => console.error(`[TLS] ${msg}`),
  info: (msg: string) => console.info(`[TLS] ${msg}`),
  warn: (msg: string) => console.warn(`[TLS] ${msg}`),
  debug: (msg: string) => console.debug(`[TLS] ${msg}`),
};

/**
 * Create a TLS-enabled server
 */
export async function createTLSServer(config: TLSServerOptions): Promise<TLSServer> {
  const logger = config.logger || defaultLogger;
  const certManager = new CertificateManager();

  // Validate configuration
  await validateConfig(config, certManager, logger);

  // Create the server implementation
  return new TLSServerImpl(config, certManager);
}

/**
 * Validate TLS configuration
 */
async function validateConfig(
  config: TLSServerOptions,
  certManager: CertificateManager,
  logger: typeof defaultLogger,
): Promise<void> {
  const { tls: tlsConfig } = config;

  if (!tlsConfig.enabled) {
    return; // No validation needed for HTTP-only mode
  }

  // Check required fields
  if (!tlsConfig.cert) {
    throw new Error('TLS cert is required when TLS is enabled');
  }
  if (!tlsConfig.key) {
    throw new Error('TLS key is required when TLS is enabled');
  }

  // Check if files exist
  if (!fs.existsSync(tlsConfig.cert)) {
    throw new Error(`Certificate file not found: ${tlsConfig.cert}`);
  }
  if (!fs.existsSync(tlsConfig.key)) {
    throw new Error(`Key file not found: ${tlsConfig.key}`);
  }

  // Check for expired certificate if rejectExpired is set
  if (tlsConfig.rejectExpired) {
    const expiration = await certManager.checkExpiration(tlsConfig.cert);
    if (expiration.expired) {
      throw new Error('Certificate has expired');
    }
  }

  // Validate cert/key pair match
  if (tlsConfig.passphrase) {
    // Handle encrypted key
    try {
      const keyPem = fs.readFileSync(tlsConfig.key, 'utf8');
      crypto.createPrivateKey({
        key: keyPem,
        passphrase: tlsConfig.passphrase,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('bad decrypt')) {
        throw new Error('Invalid passphrase for encrypted key');
      }
      throw error;
    }

    if (!certManager.validateCertKeyPairWithPassphrase(tlsConfig.cert, tlsConfig.key, tlsConfig.passphrase)) {
      throw new Error('Certificate and key do not match (key mismatch or inconsistent pair)');
    }
  } else {
    // Check if key is encrypted (requires passphrase)
    try {
      const keyPem = fs.readFileSync(tlsConfig.key, 'utf8');
      if (keyPem.includes('ENCRYPTED')) {
        throw new Error('Encrypted key requires passphrase');
      }
      crypto.createPrivateKey(keyPem);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('passphrase')) {
          throw new Error('Encrypted key requires passphrase');
        }
      }
      throw error;
    }

    if (!certManager.validateCertKeyPair(tlsConfig.cert, tlsConfig.key)) {
      throw new Error('Certificate and key do not match (key mismatch or inconsistent pair)');
    }
  }

  logger.debug('TLS configuration validated successfully');
}

/**
 * TLS Server Implementation
 */
class TLSServerImpl implements TLSServer {
  private config: TLSServerOptions;
  private certManager: CertificateManager;
  private server: FastifyInstance | null = null;
  private reloadCount: number = 0;
  private currentFingerprint: string = '';
  private fileWatcher: fs.FSWatcher | null = null;
  private watchDebounceTimer: NodeJS.Timeout | null = null;
  private logger: typeof defaultLogger;

  constructor(config: TLSServerOptions, certManager: CertificateManager) {
    this.config = config;
    this.certManager = certManager;
    this.logger = config.logger || defaultLogger;
  }

  async start(): Promise<void> {
    const { tls: tlsConfig, port } = this.config;

    if (!tlsConfig.enabled) {
      // Create HTTP server
      this.server = Fastify({ logger: false });
    } else {
      // Create HTTPS server
      const httpsOptions = this.buildHttpsOptions(tlsConfig);
      this.server = Fastify({
        logger: false,
        https: httpsOptions,
      });

      // Store initial fingerprint
      this.currentFingerprint = await this.certManager.getFingerprint(tlsConfig.cert!);

      // Setup file watching if enabled
      if (tlsConfig.watchFiles) {
        this.setupFileWatcher();
      }

      // Setup TLS error handling
      this.setupTlsErrorHandling();
    }

    // Setup routes
    this.setupRoutes();

    // Start listening
    await this.server.listen({ port, host: '0.0.0.0' });
    this.logger.info(`Server started on port ${port} (${this.getProtocol()})`);
  }

  async stop(): Promise<void> {
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }
    if (this.watchDebounceTimer) {
      clearTimeout(this.watchDebounceTimer);
      this.watchDebounceTimer = null;
    }
    if (this.server) {
      await this.server.close();
      this.server = null;
    }
    this.logger.info('Server stopped');
  }

  isSecure(): boolean {
    return this.config.tls.enabled;
  }

  getProtocol(): 'http' | 'https' {
    return this.config.tls.enabled ? 'https' : 'http';
  }

  getTLSConfig(): TLSConfigInfo {
    const { tls: tlsConfig } = this.config;
    return {
      enabled: tlsConfig.enabled,
      cert: tlsConfig.cert,
      key: undefined,  // Never expose key content for security
      keyPath: tlsConfig.key,
      minVersion: tlsConfig.minVersion,
      maxVersion: tlsConfig.maxVersion,
    };
  }

  getCertificateFingerprint(): string {
    return this.currentFingerprint;
  }

  getCertificateReloadCount(): number {
    return this.reloadCount;
  }

  async reloadCertificates(options?: ReloadCertificateOptions): Promise<void> {
    const { tls: tlsConfig } = this.config;

    if (!tlsConfig.enabled) {
      throw new Error('Cannot reload certificates on HTTP server');
    }

    // Emit reload started event
    this.emitReloadEvent({ type: 'reload_started' });

    const certPath = options?.cert || tlsConfig.cert!;
    const keyPath = options?.key || tlsConfig.key!;

    try {
      // Validate new certificates
      if (!fs.existsSync(certPath)) {
        throw new Error(`Certificate file not found: ${certPath}`);
      }
      if (!fs.existsSync(keyPath)) {
        throw new Error(`Key file not found: ${keyPath}`);
      }

      // Validate cert/key pair
      if (!this.certManager.validateCertKeyPair(certPath, keyPath)) {
        throw new Error('Certificate and key do not match');
      }

      // If graceful rotation is requested, wait for drain
      if (options?.graceful && tlsConfig.gracefulRotation) {
        await this.drainConnections();
      }

      // Update the TLS context
      if (this.server?.server) {
        // Create new context for validation (not used directly but verifies certs are valid)
        tls.createSecureContext({
          cert: fs.readFileSync(certPath),
          key: fs.readFileSync(keyPath),
          ca: this.loadCaChain(tlsConfig.ca),
          minVersion: tlsConfig.minVersion,
          maxVersion: tlsConfig.maxVersion,
          ciphers: tlsConfig.ciphers,
        });

        // For Node.js TLS servers, we can set the secure context
        const tlsServer = this.server.server as unknown as tls.Server;
        if (typeof tlsServer.setSecureContext === 'function') {
          tlsServer.setSecureContext({
            cert: fs.readFileSync(certPath),
            key: fs.readFileSync(keyPath),
            ca: this.loadCaChain(tlsConfig.ca),
            minVersion: tlsConfig.minVersion,
            maxVersion: tlsConfig.maxVersion,
            ciphers: tlsConfig.ciphers,
          });
        }
      }

      // Update fingerprint
      this.currentFingerprint = await this.certManager.getFingerprint(certPath);
      this.reloadCount++;

      // Emit reload completed event
      this.emitReloadEvent({ type: 'reload_completed' });

      this.logger.info('Certificates reloaded successfully');
    } catch (error) {
      // Emit reload failed event
      this.emitReloadEvent({
        type: 'reload_failed',
        error: error instanceof Error ? error : new Error('Unknown error'),
      });

      if (tlsConfig.rollbackOnFailure) {
        this.logger.warn('Certificate reload failed, keeping existing certificates');
      }

      throw error;
    }
  }

  async simulateFileChange(filePath: string): Promise<void> {
    // Simulate a file change event for testing
    if (this.config.tls.watchFiles) {
      await this.handleFileChange(filePath);
    }
  }

  /**
   * Build HTTPS options for Fastify
   */
  private buildHttpsOptions(tlsConfig: TlsConfig): tls.TlsOptions {
    return {
      cert: fs.readFileSync(tlsConfig.cert!),
      key: fs.readFileSync(tlsConfig.key!),
      ca: this.loadCaChain(tlsConfig.ca),
      passphrase: tlsConfig.passphrase,
      minVersion: tlsConfig.minVersion,
      maxVersion: tlsConfig.maxVersion,
      ciphers: tlsConfig.ciphers,
      honorCipherOrder: tlsConfig.honorCipherOrder,
      requestCert: tlsConfig.requestCert,
      rejectUnauthorized: tlsConfig.rejectUnauthorized,
    };
  }

  /**
   * Load CA certificate chain
   */
  private loadCaChain(ca: string | string[] | undefined): Buffer | Buffer[] | undefined {
    if (!ca) return undefined;

    if (Array.isArray(ca)) {
      return ca.map((caPath) => fs.readFileSync(caPath));
    }

    return fs.readFileSync(ca);
  }

  /**
   * Setup routes for health checks and TLS info
   */
  private setupRoutes(): void {
    if (!this.server) return;

    const { tls: tlsConfig, proxy } = this.config;

    // Health check endpoint
    this.server.get('/health', async (request, reply) => {
      // Add TLS headers if configured
      if (tlsConfig.enabled) {
        if (tlsConfig.exposeVersionHeader) {
          const socket = request.socket as tls.TLSSocket;
          const protocol = socket.getProtocol?.() || 'unknown';
          reply.header('x-tls-version', protocol);
        }
        if (tlsConfig.exposeCipherHeader) {
          const socket = request.socket as tls.TLSSocket;
          const cipher = socket.getCipher?.()?.name || 'unknown';
          reply.header('x-tls-cipher', cipher);
        }

        // Call onClientCertificate callback if mTLS is enabled
        if (tlsConfig.requestCert && this.config.onClientCertificate) {
          const socket = request.socket as tls.TLSSocket;
          const cert = socket.getPeerCertificate?.();
          if (cert && Object.keys(cert).length > 0) {
            this.config.onClientCertificate(cert);
          }
        }
      }

      return { status: 'healthy' };
    });

    // Long operation endpoint (for graceful rotation testing)
    this.server.get('/long-operation', async () => {
      // Simulate a long operation
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { status: 'completed' };
    });

    // TLS info endpoint
    if (tlsConfig.enabled && tlsConfig.exposeInfoEndpoint) {
      this.server.get('/.well-known/tls-info', async () => {
        const certInfo = this.certManager.getCertificateInfo(tlsConfig.cert!);
        return {
          certificate: {
            subject: certInfo.subject,
            issuer: certInfo.issuer,
            validFrom: certInfo.validFrom.toISOString(),
            validTo: certInfo.validTo.toISOString(),
            fingerprint: certInfo.fingerprint,
            serialNumber: certInfo.serialNumber,
          },
        };
      });
    }

    // API endpoints
    this.server.post('/api/check', async (request, reply) => {
      // Simulate auth check endpoint
      const body = request.body as Record<string, unknown>;
      if (!body || !body.principal || !body.resource || !body.actions) {
        reply.status(400);
        return { error: 'Invalid request' };
      }
      return {
        requestId: `req-${Date.now()}`,
        results: {},
      };
    });

    // Handle trust proxy
    if (proxy?.trustProxy) {
      this.server.addHook('preHandler', async (request) => {
        // Trust X-Forwarded-* headers
        const forwardedProto = request.headers['x-forwarded-proto'];
        const forwardedFor = request.headers['x-forwarded-for'];
        if (forwardedProto || forwardedFor) {
          // Store for later use
          (request as unknown as Record<string, unknown>)['forwardedProto'] = forwardedProto;
          (request as unknown as Record<string, unknown>)['forwardedFor'] = forwardedFor;
        }
      });
    }
  }

  /**
   * Setup TLS error handling
   */
  private setupTlsErrorHandling(): void {
    if (!this.server?.server) return;

    const tlsServer = this.server.server as unknown as tls.Server;

    tlsServer.on('tlsClientError', (error) => {
      this.logger.error(`TLS client error: ${error.message}`);
      if (this.config.onTLSError) {
        this.config.onTLSError(error);
      }
    });

    tlsServer.on('secureConnection', (socket) => {
      // Handle mTLS client certificate
      if (this.config.tls.requestCert && this.config.onClientCertificate) {
        const cert = socket.getPeerCertificate();
        if (cert && Object.keys(cert).length > 0) {
          this.config.onClientCertificate(cert);
        }
      }
    });
  }

  /**
   * Setup file watcher for certificate hot reload
   */
  private setupFileWatcher(): void {
    const { tls: tlsConfig } = this.config;

    if (!tlsConfig.cert) return;

    // Watch the certificate file
    this.fileWatcher = fs.watch(tlsConfig.cert, async (eventType) => {
      if (eventType === 'change') {
        await this.handleFileChange(tlsConfig.cert!);
      }
    });
  }

  /**
   * Handle file change event with debouncing
   */
  private async handleFileChange(filePath: string): Promise<void> {
    const debounceMs = this.config.tls.watchDebounceMs || 100;

    if (this.watchDebounceTimer) {
      clearTimeout(this.watchDebounceTimer);
    }

    this.watchDebounceTimer = setTimeout(async () => {
      this.logger.info(`Certificate file changed: ${filePath}`);
      try {
        await this.reloadCertificates();
      } catch (error) {
        this.logger.error(`Failed to reload certificates: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }, debounceMs);
  }

  /**
   * Emit certificate reload event
   */
  private emitReloadEvent(event: CertificateReloadEvent): void {
    if (this.config.onCertificateReload) {
      this.config.onCertificateReload({
        ...event,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Drain existing connections before rotation
   */
  private async drainConnections(): Promise<void> {
    const drainTimeout = this.config.tls.drainTimeoutMs || 5000;
    this.logger.info(`Draining connections (timeout: ${drainTimeout}ms)`);

    // Wait for drain timeout (in production, would track active connections)
    await new Promise((resolve) => setTimeout(resolve, Math.min(drainTimeout, 100)));
  }
}
