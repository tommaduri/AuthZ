/**
 * Certificate Manager
 *
 * Handles certificate validation, parsing, and management.
 */

import * as fs from 'fs';
import * as crypto from 'crypto';
import type {
  CertificateInfo,
  CertificateValidationResult,
  CertificateExpirationResult,
  CertificateSubject,
  CertificateRotationManagerOptions,
  RotationScheduleEntry,
} from './types';

/**
 * Parse Distinguished Name string into key-value pairs
 */
function parseDN(dn: string): Record<string, string> {
  const result: Record<string, string> = {};
  const parts = dn.split('\n');
  for (const part of parts) {
    const [key, ...valueParts] = part.split('=');
    if (key && valueParts.length > 0) {
      result[key.trim()] = valueParts.join('=').trim();
    }
  }
  return result;
}

/**
 * Certificate Manager for validating and managing TLS certificates
 */
export class CertificateManager {
  /**
   * Validate that a certificate and key pair match and form a valid chain
   */
  async validateChain(certPath: string, caPath: string): Promise<CertificateValidationResult> {
    try {
      const certPem = fs.readFileSync(certPath, 'utf8');
      const caPem = fs.readFileSync(caPath, 'utf8');

      const certInfo = this.parseCertificate(certPem);
      const caInfo = this.parseCertificate(caPem);

      // Check if cert is signed by the CA (simplified check)
      const certX509 = new crypto.X509Certificate(certPem);
      const caX509 = new crypto.X509Certificate(caPem);

      const valid = certX509.verify(caX509.publicKey);

      return {
        valid,
        chain: [certInfo, caInfo],
      };
    } catch (error) {
      return {
        valid: false,
        chain: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check if a certificate is expired or will expire soon
   */
  async checkExpiration(certPath: string): Promise<CertificateExpirationResult> {
    const certPem = fs.readFileSync(certPath, 'utf8');
    const x509 = new crypto.X509Certificate(certPem);

    const validFrom = new Date(x509.validFrom);
    const validTo = new Date(x509.validTo);
    const now = new Date();

    const msPerDay = 24 * 60 * 60 * 1000;
    const daysUntilExpiry = Math.floor((validTo.getTime() - now.getTime()) / msPerDay);

    return {
      expired: now > validTo,
      daysUntilExpiry,
      validFrom,
      validTo,
    };
  }

  /**
   * Get the SHA-256 fingerprint of a certificate
   */
  async getFingerprint(certPath: string): Promise<string> {
    const certPem = fs.readFileSync(certPath, 'utf8');
    const x509 = new crypto.X509Certificate(certPem);
    return x509.fingerprint256;
  }

  /**
   * Get the subject information from a certificate
   */
  async getSubject(certPath: string): Promise<CertificateSubject> {
    const certPem = fs.readFileSync(certPath, 'utf8');
    const x509 = new crypto.X509Certificate(certPem);
    const parsed = parseDN(x509.subject);

    return {
      CN: parsed.CN || '',
      O: parsed.O || '',
      OU: parsed.OU,
      C: parsed.C,
      ST: parsed.ST,
      L: parsed.L,
    };
  }

  /**
   * Get full certificate information
   */
  getCertificateInfo(certPath: string): CertificateInfo {
    const certPem = fs.readFileSync(certPath, 'utf8');
    return this.parseCertificate(certPem);
  }

  /**
   * Check if a certificate is expired
   */
  isExpired(certPath: string): boolean {
    const info = this.getCertificateInfo(certPath);
    return new Date() > info.validTo;
  }

  /**
   * Validate that a certificate and private key form a matching pair
   */
  validateCertKeyPair(certPath: string, keyPath: string): boolean {
    try {
      const certPem = fs.readFileSync(certPath, 'utf8');
      const keyPem = fs.readFileSync(keyPath, 'utf8');

      const x509 = new crypto.X509Certificate(certPem);
      const privateKey = crypto.createPrivateKey(keyPem);

      // Check if the private key matches the certificate's public key
      return x509.checkPrivateKey(privateKey);
    } catch {
      return false;
    }
  }

  /**
   * Validate that a certificate and private key form a matching pair (with passphrase)
   */
  validateCertKeyPairWithPassphrase(
    certPath: string,
    keyPath: string,
    passphrase: string,
  ): boolean {
    try {
      const certPem = fs.readFileSync(certPath, 'utf8');
      const keyPem = fs.readFileSync(keyPath, 'utf8');

      const x509 = new crypto.X509Certificate(certPem);
      const privateKey = crypto.createPrivateKey({
        key: keyPem,
        passphrase,
      });

      return x509.checkPrivateKey(privateKey);
    } catch {
      return false;
    }
  }

  /**
   * Parse a PEM-encoded certificate into CertificateInfo
   */
  private parseCertificate(certPem: string): CertificateInfo {
    const x509 = new crypto.X509Certificate(certPem);

    return {
      subject: parseDN(x509.subject),
      issuer: parseDN(x509.issuer),
      validFrom: new Date(x509.validFrom),
      validTo: new Date(x509.validTo),
      fingerprint: x509.fingerprint256,
      serialNumber: x509.serialNumber,
    };
  }
}

/**
 * Certificate Rotation Manager
 *
 * Manages scheduled certificate rotation checks and callbacks.
 */
export class CertificateRotationManager {
  private options: CertificateRotationManagerOptions;
  private certificates: Map<string, { certPath: string; keyPath: string }> = new Map();
  private schedules: Map<string, RotationScheduleEntry> = new Map();
  private intervalId: NodeJS.Timeout | null = null;
  private certManager: CertificateManager;

  constructor(options: CertificateRotationManagerOptions) {
    this.options = options;
    this.certManager = new CertificateManager();
    this.startChecking();
  }

  /**
   * Add a certificate to be monitored for rotation
   */
  addCertificate(id: string, certPath: string, keyPath: string): void {
    this.certificates.set(id, { certPath, keyPath });
    this.updateSchedule(id);
  }

  /**
   * Remove a certificate from monitoring
   */
  removeCertificate(id: string): void {
    this.certificates.delete(id);
    this.schedules.delete(id);
  }

  /**
   * Get the rotation schedule for all certificates
   */
  getRotationSchedule(): Record<string, RotationScheduleEntry> {
    const result: Record<string, RotationScheduleEntry> = {};
    for (const [id, entry] of this.schedules) {
      result[id] = entry;
    }
    return result;
  }

  /**
   * Stop the rotation manager
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Start periodic certificate checking
   */
  private startChecking(): void {
    this.intervalId = setInterval(() => {
      this.checkCertificates();
    }, this.options.checkIntervalMs);
  }

  /**
   * Check all certificates for expiration
   */
  private async checkCertificates(): Promise<void> {
    for (const [id, { certPath }] of this.certificates) {
      try {
        const expiration = await this.certManager.checkExpiration(certPath);

        if (expiration.daysUntilExpiry <= this.options.renewBeforeDays) {
          if (this.options.onRotationNeeded) {
            this.options.onRotationNeeded(id);
          }
        }

        this.updateSchedule(id);
      } catch {
        // Skip on error
      }
    }
  }

  /**
   * Update the schedule for a certificate
   */
  private updateSchedule(id: string): void {
    const certInfo = this.certificates.get(id);
    if (!certInfo) return;

    try {
      const info = this.certManager.getCertificateInfo(certInfo.certPath);
      const now = new Date();
      const msPerDay = 24 * 60 * 60 * 1000;
      const daysUntilExpiry = Math.floor((info.validTo.getTime() - now.getTime()) / msPerDay);

      this.schedules.set(id, {
        nextCheck: new Date(now.getTime() + this.options.checkIntervalMs),
        certPath: certInfo.certPath,
        keyPath: certInfo.keyPath,
        daysUntilExpiry,
      });
    } catch {
      // Skip on error
    }
  }
}
