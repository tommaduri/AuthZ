/**
 * TLS Module Exports
 *
 * Provides TLS/HTTPS server functionality with certificate management.
 */

export { createTLSServer } from './server';
export { CertificateManager, CertificateRotationManager } from './certificates';
export type {
  TLSServerOptions,
  TlsConfig,
  ProxyConfig,
  TLSLogger,
  CertificateReloadEvent,
  CertificateInfo,
  CertificateValidationResult,
  CertificateExpirationResult,
  CertificateSubject,
  TLSServer,
  TLSConfigInfo,
  ReloadCertificateOptions,
  CertificateRotationManagerOptions,
  RotationScheduleEntry,
} from './types';
