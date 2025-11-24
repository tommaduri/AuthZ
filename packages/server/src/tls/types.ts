/**
 * TLS Configuration Types
 *
 * Type definitions for TLS/HTTPS server configuration.
 */

import type tls from 'tls';

/**
 * TLS Server Configuration Options
 */
export interface TLSServerOptions {
  port: number;
  tls: TlsConfig;
  proxy?: ProxyConfig;
  integration?: 'fastify' | 'express' | 'node';
  logger?: TLSLogger;
  onClientCertificate?: (cert: tls.PeerCertificate) => void;
  onCertificateReload?: (event: CertificateReloadEvent) => void;
  onTLSError?: (error: Error) => void;
}

/**
 * TLS Configuration
 */
export interface TlsConfig {
  enabled: boolean;
  cert?: string;
  key?: string;
  ca?: string | string[];
  passphrase?: string;
  requestCert?: boolean;
  rejectUnauthorized?: boolean;
  rejectExpired?: boolean;
  minVersion?: 'TLSv1.2' | 'TLSv1.3';
  maxVersion?: 'TLSv1.2' | 'TLSv1.3';
  ciphers?: string;
  honorCipherOrder?: boolean;
  hotReload?: boolean;
  watchFiles?: boolean;
  watchDebounceMs?: number;
  rollbackOnFailure?: boolean;
  gracefulRotation?: boolean;
  drainTimeoutMs?: number;
  exposeVersionHeader?: boolean;
  exposeCipherHeader?: boolean;
  exposeInfoEndpoint?: boolean;
}

/**
 * Proxy Configuration
 */
export interface ProxyConfig {
  trustProxy?: boolean;
  proxyProtocol?: boolean;
}

/**
 * Logger interface for TLS operations
 */
export interface TLSLogger {
  error: (msg: string) => void;
  info: (msg: string) => void;
  warn: (msg: string) => void;
  debug: (msg: string) => void;
}

/**
 * Certificate reload event
 */
export interface CertificateReloadEvent {
  type: 'reload_started' | 'reload_completed' | 'reload_failed';
  timestamp?: Date;
  error?: Error;
}

/**
 * Certificate information parsed from X.509 certificate
 */
export interface CertificateInfo {
  subject: Record<string, string>;
  issuer: Record<string, string>;
  validFrom: Date;
  validTo: Date;
  fingerprint: string;
  serialNumber: string;
}

/**
 * Certificate validation result
 */
export interface CertificateValidationResult {
  valid: boolean;
  chain: CertificateInfo[];
  error?: string;
}

/**
 * Certificate expiration check result
 */
export interface CertificateExpirationResult {
  expired: boolean;
  daysUntilExpiry: number;
  validFrom: Date;
  validTo: Date;
}

/**
 * Certificate subject information
 */
export interface CertificateSubject {
  CN: string;
  O: string;
  OU?: string;
  C?: string;
  ST?: string;
  L?: string;
}

/**
 * TLS Server interface
 */
export interface TLSServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  isSecure(): boolean;
  getProtocol(): 'http' | 'https';
  getTLSConfig(): TLSConfigInfo;
  getCertificateFingerprint(): string;
  getCertificateReloadCount(): number;
  reloadCertificates(options?: ReloadCertificateOptions): Promise<void>;
  simulateFileChange(filePath: string): Promise<void>;
}

/**
 * TLS configuration info (safe to expose)
 * Note: key is intentionally undefined to avoid exposing private key content
 */
export interface TLSConfigInfo {
  enabled: boolean;
  cert?: string;
  key?: undefined;  // Never expose key content
  keyPath?: string;
  minVersion?: string;
  maxVersion?: string;
}

/**
 * Options for certificate reload
 */
export interface ReloadCertificateOptions {
  cert?: string;
  key?: string;
  graceful?: boolean;
}

/**
 * Certificate rotation manager options
 */
export interface CertificateRotationManagerOptions {
  checkIntervalMs: number;
  renewBeforeDays: number;
  onRotationNeeded?: (certId: string) => void;
}

/**
 * Rotation schedule entry
 */
export interface RotationScheduleEntry {
  nextCheck: Date;
  certPath: string;
  keyPath: string;
  daysUntilExpiry?: number;
}
