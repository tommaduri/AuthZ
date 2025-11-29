# Secrets Management - Software Design Document

| Field | Value |
|-------|-------|
| **Document ID** | SDD-SECRETS-001 |
| **Version** | 1.0.0 |
| **Status** | Draft |
| **Created** | 2025-01-15 |
| **Last Updated** | 2025-01-15 |
| **Author** | AuthZ Engine Team |
| **Reviewers** | Security Team, Platform Team |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Secrets Categories](#3-secrets-categories)
4. [HashiCorp Vault Integration](#4-hashicorp-vault-integration)
5. [Secret Rotation](#5-secret-rotation)
6. [Kubernetes Secrets](#6-kubernetes-secrets)
7. [Cloud Provider Integration](#7-cloud-provider-integration)
8. [Zero-Trust Secret Access](#8-zero-trust-secret-access)
9. [Encryption Standards](#9-encryption-standards)
10. [Audit and Compliance](#10-audit-and-compliance)
11. [Emergency Procedures](#11-emergency-procedures)
12. [Implementation Guide](#12-implementation-guide)

---

## 1. Executive Summary

### 1.1 Purpose

This document defines the secrets management architecture for the AuthZ Engine, covering secure storage, automatic rotation, access control, and compliance requirements for handling sensitive credentials across all deployment environments.

### 1.2 Scope

- HashiCorp Vault integration for centralized secrets
- Automatic secret rotation with zero-downtime
- Kubernetes secrets integration (CSI driver, external-secrets)
- Cloud provider secret services (AWS Secrets Manager, GCP Secret Manager, Azure Key Vault)
- Encryption at rest and in transit
- Audit logging for secret access

### 1.3 Security Principles

```
┌─────────────────────────────────────────────────────────────────┐
│                    SECRETS MANAGEMENT PRINCIPLES                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. ZERO TRUST          - Every access is authenticated         │
│  2. LEAST PRIVILEGE     - Minimal permissions per service       │
│  3. DEFENSE IN DEPTH    - Multiple layers of protection         │
│  4. AUTOMATIC ROTATION  - No long-lived credentials             │
│  5. COMPLETE AUDIT      - Every access is logged                │
│  6. ENCRYPTION ALWAYS   - At rest and in transit                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Architecture Overview

### 2.1 High-Level Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                      SECRETS MANAGEMENT ARCHITECTURE                    │
├────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐              │
│   │ AuthZ Core  │     │ AuthZ Agent │     │   Server    │              │
│   │   Service   │     │   Service   │     │   Service   │              │
│   └──────┬──────┘     └──────┬──────┘     └──────┬──────┘              │
│          │                   │                   │                      │
│          └───────────────────┼───────────────────┘                      │
│                              │                                          │
│                    ┌─────────▼─────────┐                               │
│                    │  Secrets Client   │                               │
│                    │    Abstraction    │                               │
│                    └─────────┬─────────┘                               │
│                              │                                          │
│         ┌────────────────────┼────────────────────┐                    │
│         │                    │                    │                     │
│   ┌─────▼─────┐       ┌─────▼─────┐       ┌─────▼─────┐               │
│   │ HashiCorp │       │Kubernetes │       │  Cloud    │               │
│   │   Vault   │       │  Secrets  │       │ Provider  │               │
│   └─────┬─────┘       └─────┬─────┘       └─────┬─────┘               │
│         │                   │                   │                      │
│   ┌─────▼─────┐       ┌─────▼─────┐       ┌─────▼─────┐               │
│   │  Transit  │       │   CSI     │       │   AWS/    │               │
│   │  Backend  │       │  Driver   │       │  GCP/Azure│               │
│   └───────────┘       └───────────┘       └───────────┘               │
│                                                                         │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Secret Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        SECRET LIFECYCLE                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐ │
│   │ Generate │───▶│  Store   │───▶│  Access  │───▶│  Rotate  │ │
│   └──────────┘    └──────────┘    └──────────┘    └──────────┘ │
│        │               │               │               │        │
│        ▼               ▼               ▼               ▼        │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐ │
│   │ Strong   │    │ Encrypted│    │Audit Log │    │Zero-Down │ │
│   │ Entropy  │    │ At Rest  │    │ Created  │    │  time    │ │
│   └──────────┘    └──────────┘    └──────────┘    └──────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Secrets Categories

### 3.1 Secret Classification

| Category | Description | Rotation Frequency | Access Control |
|----------|-------------|-------------------|----------------|
| **Database Credentials** | PostgreSQL, Redis passwords | 24 hours | Service accounts only |
| **API Keys** | External service API keys | 30 days | Role-based |
| **TLS Certificates** | mTLS, server certs | 90 days | Automated |
| **Encryption Keys** | Data encryption keys | 365 days | HSM-backed |
| **JWT Signing Keys** | Token signing keys | 7 days | Core service only |
| **Service Tokens** | Inter-service auth | 1 hour | Dynamic |

### 3.2 TypeScript Secret Types

```typescript
// packages/core/src/secrets/types.ts

export enum SecretType {
  DATABASE_CREDENTIAL = 'database_credential',
  API_KEY = 'api_key',
  TLS_CERTIFICATE = 'tls_certificate',
  ENCRYPTION_KEY = 'encryption_key',
  JWT_SIGNING_KEY = 'jwt_signing_key',
  SERVICE_TOKEN = 'service_token',
}

export interface SecretMetadata {
  id: string;
  type: SecretType;
  name: string;
  version: number;
  createdAt: Date;
  expiresAt: Date;
  rotatedAt?: Date;
  lastAccessedAt?: Date;
  tags: Record<string, string>;
}

export interface Secret {
  metadata: SecretMetadata;
  value: string | Buffer;
}

export interface SecretReference {
  provider: 'vault' | 'kubernetes' | 'aws' | 'gcp' | 'azure';
  path: string;
  key?: string;
  version?: string;
}

export interface RotationConfig {
  enabled: boolean;
  intervalSeconds: number;
  gracePeriodSeconds: number;
  notifyBeforeSeconds: number;
}
```

---

## 4. HashiCorp Vault Integration

### 4.1 Vault Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    VAULT CLUSTER ARCHITECTURE                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                    ┌─────────────────┐                          │
│                    │   HAProxy/NLB   │                          │
│                    └────────┬────────┘                          │
│                             │                                    │
│         ┌───────────────────┼───────────────────┐               │
│         │                   │                   │                │
│   ┌─────▼─────┐       ┌─────▼─────┐       ┌─────▼─────┐        │
│   │  Vault 1  │       │  Vault 2  │       │  Vault 3  │        │
│   │  (Active) │       │ (Standby) │       │ (Standby) │        │
│   └─────┬─────┘       └─────┬─────┘       └─────┬─────┘        │
│         │                   │                   │                │
│         └───────────────────┼───────────────────┘               │
│                             │                                    │
│                    ┌────────▼────────┐                          │
│                    │  Consul/Raft    │                          │
│                    │   (Storage)     │                          │
│                    └─────────────────┘                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Vault Client Implementation

```typescript
// packages/core/src/secrets/vault-client.ts

import Vault from 'node-vault';

export interface VaultConfig {
  endpoint: string;
  namespace?: string;
  authMethod: 'kubernetes' | 'approle' | 'token';
  roleId?: string;
  secretId?: string;
  tokenPath?: string;
  tlsCert?: string;
  tlsKey?: string;
  caCert?: string;
}

export class VaultClient {
  private client: Vault.client;
  private token: string | null = null;
  private tokenExpiry: Date | null = null;
  private renewalTimer: NodeJS.Timer | null = null;

  constructor(private config: VaultConfig) {
    this.client = Vault({
      endpoint: config.endpoint,
      namespace: config.namespace,
      requestOptions: {
        ca: config.caCert,
        cert: config.tlsCert,
        key: config.tlsKey,
      },
    });
  }

  async authenticate(): Promise<void> {
    switch (this.config.authMethod) {
      case 'kubernetes':
        await this.authenticateKubernetes();
        break;
      case 'approle':
        await this.authenticateAppRole();
        break;
      case 'token':
        await this.authenticateToken();
        break;
    }
    this.scheduleTokenRenewal();
  }

  private async authenticateKubernetes(): Promise<void> {
    const jwt = await fs.readFile(
      '/var/run/secrets/kubernetes.io/serviceaccount/token',
      'utf8'
    );

    const result = await this.client.kubernetesLogin({
      role: 'authz-engine',
      jwt,
    });

    this.token = result.auth.client_token;
    this.tokenExpiry = new Date(Date.now() + result.auth.lease_duration * 1000);
    this.client.token = this.token;
  }

  private async authenticateAppRole(): Promise<void> {
    const result = await this.client.approleLogin({
      role_id: this.config.roleId!,
      secret_id: this.config.secretId!,
    });

    this.token = result.auth.client_token;
    this.tokenExpiry = new Date(Date.now() + result.auth.lease_duration * 1000);
    this.client.token = this.token;
  }

  async getSecret(path: string): Promise<Secret> {
    const result = await this.client.read(path);

    return {
      metadata: {
        id: path,
        type: this.inferSecretType(path),
        name: path.split('/').pop()!,
        version: result.metadata?.version ?? 1,
        createdAt: new Date(result.metadata?.created_time),
        expiresAt: this.calculateExpiry(result),
        tags: result.metadata?.custom_metadata ?? {},
      },
      value: result.data.data ?? result.data,
    };
  }

  async writeSecret(path: string, data: Record<string, any>): Promise<void> {
    await this.client.write(path, { data });
  }

  async rotateSecret(path: string): Promise<Secret> {
    // Generate new secret value
    const newValue = await this.generateSecretValue(path);

    // Write new version
    await this.writeSecret(path, newValue);

    return this.getSecret(path);
  }

  async getDynamicDatabaseCredential(role: string): Promise<DatabaseCredential> {
    const result = await this.client.read(`database/creds/${role}`);

    return {
      username: result.data.username,
      password: result.data.password,
      leaseId: result.lease_id,
      leaseDuration: result.lease_duration,
    };
  }

  private scheduleTokenRenewal(): void {
    if (this.renewalTimer) {
      clearTimeout(this.renewalTimer);
    }

    const renewalTime = (this.tokenExpiry!.getTime() - Date.now()) * 0.75;

    this.renewalTimer = setTimeout(async () => {
      await this.client.tokenRenewSelf();
      this.scheduleTokenRenewal();
    }, renewalTime);
  }
}

interface DatabaseCredential {
  username: string;
  password: string;
  leaseId: string;
  leaseDuration: number;
}
```

### 4.3 Vault Policy Configuration

```hcl
# vault/policies/authz-engine.hcl

# Read secrets for authz-engine
path "secret/data/authz-engine/*" {
  capabilities = ["read", "list"]
}

# Dynamic database credentials
path "database/creds/authz-engine-*" {
  capabilities = ["read"]
}

# Transit encryption
path "transit/encrypt/authz-engine" {
  capabilities = ["update"]
}

path "transit/decrypt/authz-engine" {
  capabilities = ["update"]
}

# PKI certificates
path "pki/issue/authz-engine" {
  capabilities = ["create", "update"]
}

# Token self-renewal
path "auth/token/renew-self" {
  capabilities = ["update"]
}
```

### 4.4 Kubernetes Auth Configuration

```yaml
# vault/kubernetes-auth.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: vault-kubernetes-auth-config
spec:
  template:
    spec:
      serviceAccountName: vault-auth
      containers:
      - name: vault-config
        image: hashicorp/vault:1.15
        env:
        - name: VAULT_ADDR
          value: "https://vault.vault.svc:8200"
        command:
        - /bin/sh
        - -c
        - |
          vault auth enable kubernetes

          vault write auth/kubernetes/config \
            kubernetes_host="https://kubernetes.default.svc:443" \
            kubernetes_ca_cert=@/var/run/secrets/kubernetes.io/serviceaccount/ca.crt \
            token_reviewer_jwt=@/var/run/secrets/kubernetes.io/serviceaccount/token

          vault write auth/kubernetes/role/authz-engine \
            bound_service_account_names=authz-engine \
            bound_service_account_namespaces=authz-system \
            policies=authz-engine \
            ttl=1h
```

---

## 5. Secret Rotation

### 5.1 Rotation Manager

```typescript
// packages/core/src/secrets/rotation-manager.ts

export interface RotationStrategy {
  type: 'immediate' | 'gradual' | 'blue-green';
  gracePeriodSeconds: number;
  verifyAfterRotation: boolean;
}

export class SecretRotationManager {
  private rotationSchedules: Map<string, NodeJS.Timer> = new Map();
  private activeSecrets: Map<string, Secret[]> = new Map();

  constructor(
    private secretsClient: SecretsClient,
    private notifier: RotationNotifier,
    private metrics: MetricsCollector,
  ) {}

  async scheduleRotation(
    secretPath: string,
    config: RotationConfig,
    strategy: RotationStrategy,
  ): Promise<void> {
    // Clear existing schedule
    const existing = this.rotationSchedules.get(secretPath);
    if (existing) {
      clearInterval(existing);
    }

    // Schedule rotation
    const timer = setInterval(
      () => this.rotateSecret(secretPath, strategy),
      config.intervalSeconds * 1000,
    );

    this.rotationSchedules.set(secretPath, timer);

    // Schedule pre-rotation notification
    if (config.notifyBeforeSeconds > 0) {
      this.scheduleNotification(secretPath, config);
    }
  }

  private async rotateSecret(
    secretPath: string,
    strategy: RotationStrategy,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      switch (strategy.type) {
        case 'immediate':
          await this.immediateRotation(secretPath);
          break;
        case 'gradual':
          await this.gradualRotation(secretPath, strategy.gracePeriodSeconds);
          break;
        case 'blue-green':
          await this.blueGreenRotation(secretPath);
          break;
      }

      if (strategy.verifyAfterRotation) {
        await this.verifyRotation(secretPath);
      }

      this.metrics.recordRotation(secretPath, 'success', Date.now() - startTime);
    } catch (error) {
      this.metrics.recordRotation(secretPath, 'failure', Date.now() - startTime);
      await this.notifier.notifyRotationFailure(secretPath, error);
      throw error;
    }
  }

  private async gradualRotation(
    secretPath: string,
    gracePeriodSeconds: number,
  ): Promise<void> {
    // Generate new secret
    const newSecret = await this.secretsClient.rotateSecret(secretPath);

    // Keep both old and new active
    const secrets = this.activeSecrets.get(secretPath) ?? [];
    secrets.push(newSecret);
    this.activeSecrets.set(secretPath, secrets);

    // Schedule old secret removal
    setTimeout(async () => {
      const current = this.activeSecrets.get(secretPath) ?? [];
      this.activeSecrets.set(secretPath, current.slice(-1));
    }, gracePeriodSeconds * 1000);
  }

  private async blueGreenRotation(secretPath: string): Promise<void> {
    // Generate new secret in "green" slot
    const newSecret = await this.secretsClient.rotateSecret(secretPath);

    // Verify new secret works
    await this.verifySecret(newSecret);

    // Atomic switch
    this.activeSecrets.set(secretPath, [newSecret]);
  }

  async getCurrentSecret(secretPath: string): Promise<Secret> {
    const secrets = this.activeSecrets.get(secretPath);
    if (!secrets?.length) {
      const secret = await this.secretsClient.getSecret(secretPath);
      this.activeSecrets.set(secretPath, [secret]);
      return secret;
    }
    return secrets[secrets.length - 1];
  }

  async getAllActiveSecrets(secretPath: string): Promise<Secret[]> {
    return this.activeSecrets.get(secretPath) ?? [];
  }
}
```

### 5.2 Database Credential Rotation

```typescript
// packages/core/src/secrets/database-rotation.ts

export class DatabaseCredentialRotator {
  constructor(
    private vaultClient: VaultClient,
    private dbPool: DatabasePool,
  ) {}

  async rotateCredentials(role: string): Promise<void> {
    // Get new credentials from Vault
    const newCreds = await this.vaultClient.getDynamicDatabaseCredential(role);

    // Create new connection pool with new credentials
    const newPool = await this.createPool(newCreds);

    // Verify new pool works
    await this.verifyConnection(newPool);

    // Gracefully drain old pool
    await this.dbPool.drain();

    // Switch to new pool
    this.dbPool.replace(newPool);

    // Schedule lease renewal
    this.scheduleLeasekRenewal(newCreds.leaseId, newCreds.leaseDuration);
  }

  private scheduleLeasekRenewal(leaseId: string, duration: number): void {
    // Renew at 75% of lease duration
    const renewalTime = duration * 0.75 * 1000;

    setTimeout(async () => {
      try {
        await this.vaultClient.renewLease(leaseId);
        this.scheduleLeasekRenewal(leaseId, duration);
      } catch {
        // Lease renewal failed, rotate credentials
        await this.rotateCredentials(this.currentRole);
      }
    }, renewalTime);
  }
}
```

### 5.3 JWT Signing Key Rotation

```typescript
// packages/core/src/secrets/jwt-rotation.ts

export class JWTKeyRotator {
  private keys: JWKSet;
  private currentKeyId: string;

  constructor(
    private vaultClient: VaultClient,
    private jwksPublisher: JWKSPublisher,
  ) {}

  async rotateSigningKey(): Promise<void> {
    // Generate new key pair in Vault
    const newKey = await this.vaultClient.generateTransitKey('jwt-signing');

    // Add to JWKS with new kid
    const newKid = `key-${Date.now()}`;
    await this.keys.addKey({
      kid: newKid,
      ...newKey.publicKey,
    });

    // Publish updated JWKS
    await this.jwksPublisher.publish(this.keys);

    // Wait for propagation
    await this.waitForPropagation();

    // Switch to new key for signing
    this.currentKeyId = newKid;

    // Schedule old key removal (after max token lifetime)
    setTimeout(() => {
      this.keys.removeKey(this.previousKeyId);
      this.jwksPublisher.publish(this.keys);
    }, 24 * 60 * 60 * 1000); // 24 hours
  }

  async signToken(payload: object): Promise<string> {
    return this.vaultClient.transitSign(
      'jwt-signing',
      JSON.stringify(payload),
      this.currentKeyId,
    );
  }
}
```

---

## 6. Kubernetes Secrets

### 6.1 External Secrets Operator

```yaml
# kubernetes/external-secrets/secret-store.yaml
apiVersion: external-secrets.io/v1beta1
kind: ClusterSecretStore
metadata:
  name: vault-backend
spec:
  provider:
    vault:
      server: "https://vault.vault.svc:8200"
      path: "secret"
      version: "v2"
      namespace: "authz"
      auth:
        kubernetes:
          mountPath: "kubernetes"
          role: "authz-engine"
          serviceAccountRef:
            name: "authz-engine"
            namespace: "authz-system"

---
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: authz-database-credentials
  namespace: authz-system
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault-backend
    kind: ClusterSecretStore
  target:
    name: authz-database-credentials
    creationPolicy: Owner
    template:
      type: Opaque
      data:
        DATABASE_URL: "postgresql://{{ .username }}:{{ .password }}@postgres:5432/authz"
  data:
  - secretKey: username
    remoteRef:
      key: secret/data/authz-engine/database
      property: username
  - secretKey: password
    remoteRef:
      key: secret/data/authz-engine/database
      property: password
```

### 6.2 CSI Secret Store Driver

```yaml
# kubernetes/csi-secrets/secret-provider-class.yaml
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: authz-vault-secrets
  namespace: authz-system
spec:
  provider: vault
  parameters:
    vaultAddress: "https://vault.vault.svc:8200"
    roleName: "authz-engine"
    objects: |
      - objectName: "database-password"
        secretPath: "secret/data/authz-engine/database"
        secretKey: "password"
      - objectName: "redis-password"
        secretPath: "secret/data/authz-engine/redis"
        secretKey: "password"
      - objectName: "jwt-signing-key"
        secretPath: "secret/data/authz-engine/jwt"
        secretKey: "private_key"
  secretObjects:
  - secretName: authz-secrets
    type: Opaque
    data:
    - objectName: database-password
      key: DATABASE_PASSWORD
    - objectName: redis-password
      key: REDIS_PASSWORD
    - objectName: jwt-signing-key
      key: JWT_SIGNING_KEY

---
# Pod using CSI secrets
apiVersion: v1
kind: Pod
metadata:
  name: authz-engine
spec:
  serviceAccountName: authz-engine
  containers:
  - name: authz-engine
    image: authz-engine:latest
    volumeMounts:
    - name: secrets-store
      mountPath: "/mnt/secrets"
      readOnly: true
    env:
    - name: DATABASE_PASSWORD
      valueFrom:
        secretKeyRef:
          name: authz-secrets
          key: DATABASE_PASSWORD
  volumes:
  - name: secrets-store
    csi:
      driver: secrets-store.csi.k8s.io
      readOnly: true
      volumeAttributes:
        secretProviderClass: "authz-vault-secrets"
```

---

## 7. Cloud Provider Integration

### 7.1 AWS Secrets Manager

```typescript
// packages/core/src/secrets/aws-secrets-manager.ts

import {
  SecretsManagerClient,
  GetSecretValueCommand,
  RotateSecretCommand,
  CreateSecretCommand,
} from '@aws-sdk/client-secrets-manager';

export class AWSSecretsManager implements SecretsProvider {
  private client: SecretsManagerClient;

  constructor(region: string) {
    this.client = new SecretsManagerClient({ region });
  }

  async getSecret(secretId: string): Promise<Secret> {
    const command = new GetSecretValueCommand({
      SecretId: secretId,
      VersionStage: 'AWSCURRENT',
    });

    const response = await this.client.send(command);

    return {
      metadata: {
        id: response.ARN!,
        name: response.Name!,
        version: parseInt(response.VersionId ?? '1'),
        createdAt: response.CreatedDate!,
        tags: {},
      },
      value: response.SecretString ?? response.SecretBinary!,
    };
  }

  async rotateSecret(secretId: string): Promise<void> {
    const command = new RotateSecretCommand({
      SecretId: secretId,
      RotationLambdaARN: process.env.ROTATION_LAMBDA_ARN,
      RotationRules: {
        AutomaticallyAfterDays: 30,
      },
    });

    await this.client.send(command);
  }
}
```

### 7.2 GCP Secret Manager

```typescript
// packages/core/src/secrets/gcp-secret-manager.ts

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

export class GCPSecretManager implements SecretsProvider {
  private client: SecretManagerServiceClient;
  private projectId: string;

  constructor(projectId: string) {
    this.client = new SecretManagerServiceClient();
    this.projectId = projectId;
  }

  async getSecret(secretName: string, version = 'latest'): Promise<Secret> {
    const name = `projects/${this.projectId}/secrets/${secretName}/versions/${version}`;

    const [response] = await this.client.accessSecretVersion({ name });

    return {
      metadata: {
        id: response.name!,
        name: secretName,
        version: parseInt(version === 'latest' ? '0' : version),
        createdAt: new Date(),
        tags: {},
      },
      value: response.payload!.data!.toString(),
    };
  }

  async createSecretVersion(
    secretName: string,
    payload: string,
  ): Promise<string> {
    const parent = `projects/${this.projectId}/secrets/${secretName}`;

    const [version] = await this.client.addSecretVersion({
      parent,
      payload: {
        data: Buffer.from(payload),
      },
    });

    return version.name!;
  }
}
```

### 7.3 Azure Key Vault

```typescript
// packages/core/src/secrets/azure-key-vault.ts

import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';

export class AzureKeyVault implements SecretsProvider {
  private client: SecretClient;

  constructor(vaultUrl: string) {
    const credential = new DefaultAzureCredential();
    this.client = new SecretClient(vaultUrl, credential);
  }

  async getSecret(secretName: string): Promise<Secret> {
    const secret = await this.client.getSecret(secretName);

    return {
      metadata: {
        id: secret.properties.id!,
        name: secret.name,
        version: 1,
        createdAt: secret.properties.createdOn!,
        expiresAt: secret.properties.expiresOn,
        tags: secret.properties.tags ?? {},
      },
      value: secret.value!,
    };
  }

  async setSecret(secretName: string, value: string): Promise<void> {
    await this.client.setSecret(secretName, value, {
      expiresOn: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
  }
}
```

---

## 8. Zero-Trust Secret Access

### 8.1 Access Control Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    ZERO-TRUST SECRET ACCESS                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────────┐                                              │
│   │   Service    │                                              │
│   │   Request    │                                              │
│   └──────┬───────┘                                              │
│          │                                                       │
│          ▼                                                       │
│   ┌──────────────┐                                              │
│   │   Identity   │  ← Service Account / mTLS / SPIFFE           │
│   │ Verification │                                              │
│   └──────┬───────┘                                              │
│          │                                                       │
│          ▼                                                       │
│   ┌──────────────┐                                              │
│   │   Policy     │  ← OPA / AuthZ Engine Policy                 │
│   │   Check      │                                              │
│   └──────┬───────┘                                              │
│          │                                                       │
│          ▼                                                       │
│   ┌──────────────┐                                              │
│   │   Context    │  ← Environment / Time / Location             │
│   │ Validation   │                                              │
│   └──────┬───────┘                                              │
│          │                                                       │
│          ▼                                                       │
│   ┌──────────────┐                                              │
│   │   Audit      │  ← Complete Access Log                       │
│   │   Log        │                                              │
│   └──────┬───────┘                                              │
│          │                                                       │
│          ▼                                                       │
│   ┌──────────────┐                                              │
│   │   Secret     │                                              │
│   │   Delivery   │                                              │
│   └──────────────┘                                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 SPIFFE/SPIRE Integration

```typescript
// packages/core/src/secrets/spiffe-auth.ts

import { SpiffeIdManager } from '@spiffe/spiffe-sdk';

export class SPIFFESecretAuth {
  private idManager: SpiffeIdManager;

  constructor(socketPath: string) {
    this.idManager = new SpiffeIdManager({
      socketPath,
    });
  }

  async getWorkloadIdentity(): Promise<WorkloadIdentity> {
    const svid = await this.idManager.fetchX509SVID();

    return {
      spiffeId: svid.spiffeId,
      certificate: svid.certificate,
      privateKey: svid.privateKey,
      bundle: svid.bundle,
    };
  }

  async authenticateToVault(vaultClient: VaultClient): Promise<string> {
    const identity = await this.getWorkloadIdentity();

    return vaultClient.authenticateSPIFFE(
      identity.certificate,
      identity.privateKey,
    );
  }
}

interface WorkloadIdentity {
  spiffeId: string;
  certificate: Buffer;
  privateKey: Buffer;
  bundle: Buffer;
}
```

---

## 9. Encryption Standards

### 9.1 Encryption Configuration

| Data Type | Algorithm | Key Size | Mode |
|-----------|-----------|----------|------|
| Secrets at Rest | AES-256 | 256-bit | GCM |
| Secrets in Transit | TLS 1.3 | P-384 | ECDHE |
| Database Fields | AES-256 | 256-bit | GCM |
| Backup Encryption | AES-256 | 256-bit | GCM |
| Key Wrapping | RSA-OAEP | 4096-bit | SHA-256 |

### 9.2 Transit Encryption Service

```typescript
// packages/core/src/secrets/transit-encryption.ts

export class TransitEncryption {
  constructor(private vaultClient: VaultClient) {}

  async encrypt(
    keyName: string,
    plaintext: string | Buffer,
  ): Promise<string> {
    const b64Plaintext = Buffer.from(plaintext).toString('base64');

    const result = await this.vaultClient.write(
      `transit/encrypt/${keyName}`,
      { plaintext: b64Plaintext },
    );

    return result.data.ciphertext;
  }

  async decrypt(keyName: string, ciphertext: string): Promise<Buffer> {
    const result = await this.vaultClient.write(
      `transit/decrypt/${keyName}`,
      { ciphertext },
    );

    return Buffer.from(result.data.plaintext, 'base64');
  }

  async rewrap(
    keyName: string,
    ciphertext: string,
    version?: number,
  ): Promise<string> {
    const result = await this.vaultClient.write(
      `transit/rewrap/${keyName}`,
      {
        ciphertext,
        key_version: version,
      },
    );

    return result.data.ciphertext;
  }

  async generateDataKey(
    keyName: string,
    bits: 256 | 512 = 256,
  ): Promise<DataKey> {
    const result = await this.vaultClient.write(
      `transit/datakey/wrapped/${keyName}`,
      { bits },
    );

    return {
      ciphertext: result.data.ciphertext,
      plaintext: Buffer.from(result.data.plaintext, 'base64'),
    };
  }
}

interface DataKey {
  ciphertext: string;
  plaintext: Buffer;
}
```

---

## 10. Audit and Compliance

### 10.1 Secret Access Audit

```typescript
// packages/core/src/secrets/audit-logger.ts

export interface SecretAccessEvent {
  timestamp: Date;
  eventType: 'read' | 'write' | 'rotate' | 'delete';
  secretPath: string;
  principal: {
    type: 'service' | 'user';
    id: string;
    spiffeId?: string;
  };
  context: {
    sourceIp: string;
    userAgent: string;
    requestId: string;
  };
  result: 'success' | 'denied' | 'error';
  reason?: string;
}

export class SecretAuditLogger {
  constructor(
    private auditStore: AuditStore,
    private alertManager: AlertManager,
  ) {}

  async logAccess(event: SecretAccessEvent): Promise<void> {
    // Store audit event
    await this.auditStore.store({
      ...event,
      hash: this.computeEventHash(event),
    });

    // Alert on suspicious activity
    if (this.isSuspicious(event)) {
      await this.alertManager.alert({
        severity: 'high',
        title: 'Suspicious Secret Access',
        details: event,
      });
    }
  }

  private isSuspicious(event: SecretAccessEvent): boolean {
    return (
      event.result === 'denied' ||
      this.isHighValueSecret(event.secretPath) ||
      this.isUnusualAccessPattern(event)
    );
  }

  async generateComplianceReport(
    startDate: Date,
    endDate: Date,
  ): Promise<ComplianceReport> {
    const events = await this.auditStore.query({
      startDate,
      endDate,
    });

    return {
      period: { startDate, endDate },
      totalAccesses: events.length,
      uniqueSecrets: new Set(events.map(e => e.secretPath)).size,
      accessByPrincipal: this.groupByPrincipal(events),
      deniedAccesses: events.filter(e => e.result === 'denied'),
      rotations: events.filter(e => e.eventType === 'rotate'),
    };
  }
}
```

### 10.2 Compliance Requirements

| Requirement | Control | Implementation |
|-------------|---------|----------------|
| SOC2 CC6.1 | Access Control | RBAC + SPIFFE identity |
| SOC2 CC6.6 | Encryption | AES-256-GCM at rest |
| PCI-DSS 3.5 | Key Management | HSM-backed keys |
| PCI-DSS 3.6 | Key Rotation | Automatic 90-day rotation |
| HIPAA 164.312 | Audit Controls | Complete access logging |
| GDPR Art.32 | Security | Encryption + access control |

---

## 11. Emergency Procedures

### 11.1 Secret Compromise Response

```
┌─────────────────────────────────────────────────────────────────┐
│                SECRET COMPROMISE RESPONSE PLAN                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PHASE 1: IMMEDIATE (0-15 minutes)                              │
│  ├── Revoke compromised secret                                  │
│  ├── Generate new secret                                        │
│  ├── Update all consuming services                              │
│  └── Enable enhanced monitoring                                 │
│                                                                  │
│  PHASE 2: CONTAINMENT (15-60 minutes)                          │
│  ├── Identify scope of compromise                               │
│  ├── Review audit logs for unauthorized access                  │
│  ├── Rotate related secrets (blast radius)                      │
│  └── Notify security team                                       │
│                                                                  │
│  PHASE 3: RECOVERY (1-4 hours)                                  │
│  ├── Complete security assessment                               │
│  ├── Update access policies                                     │
│  ├── Implement additional controls                              │
│  └── Document incident                                          │
│                                                                  │
│  PHASE 4: POST-INCIDENT (24-48 hours)                          │
│  ├── Root cause analysis                                        │
│  ├── Process improvements                                       │
│  ├── Training updates                                           │
│  └── Compliance reporting                                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 11.2 Emergency Rotation Script

```bash
#!/bin/bash
# scripts/emergency-rotation.sh

set -euo pipefail

SECRET_PATH=$1
REASON=$2

echo "=== EMERGENCY SECRET ROTATION ==="
echo "Secret: $SECRET_PATH"
echo "Reason: $REASON"
echo "Time: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# 1. Revoke current secret
echo "Revoking current secret..."
vault kv metadata delete -mount=secret "$SECRET_PATH"

# 2. Generate new secret
echo "Generating new secret..."
NEW_SECRET=$(openssl rand -base64 32)
vault kv put -mount=secret "$SECRET_PATH" value="$NEW_SECRET"

# 3. Force refresh in all services
echo "Triggering service refresh..."
kubectl rollout restart deployment/authz-engine -n authz-system

# 4. Enable enhanced monitoring
echo "Enabling enhanced monitoring..."
vault audit enable file file_path=/var/log/vault/emergency-audit.log

# 5. Send alert
echo "Sending security alert..."
curl -X POST "$SLACK_WEBHOOK" \
  -H "Content-Type: application/json" \
  -d "{\"text\": \"EMERGENCY: Secret rotation completed for $SECRET_PATH. Reason: $REASON\"}"

echo "=== ROTATION COMPLETE ==="
```

---

## 12. Implementation Guide

### 12.1 Implementation Phases

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| 1. Foundation | 2 weeks | Vault cluster, basic policies |
| 2. Integration | 2 weeks | Service integration, rotation |
| 3. Kubernetes | 1 week | CSI driver, external secrets |
| 4. Compliance | 1 week | Audit logging, reporting |
| 5. Operations | 1 week | Runbooks, monitoring |

### 12.2 Configuration Reference

```yaml
# config/secrets.yaml
secrets:
  provider: vault
  vault:
    address: https://vault.example.com:8200
    namespace: authz
    auth:
      method: kubernetes
      role: authz-engine
    tls:
      ca_cert: /etc/vault/ca.crt
      client_cert: /etc/vault/client.crt
      client_key: /etc/vault/client.key

  rotation:
    database:
      enabled: true
      interval: 24h
      strategy: gradual
      grace_period: 5m

    jwt_signing:
      enabled: true
      interval: 7d
      strategy: blue-green

    api_keys:
      enabled: true
      interval: 30d
      notify_before: 7d

  encryption:
    transit_key: authz-engine
    algorithm: aes256-gcm96

  audit:
    enabled: true
    log_requests: true
    log_responses: false
    sensitive_paths:
      - secret/data/authz-engine/database
      - secret/data/authz-engine/jwt
```

### 12.3 Operational Runbook

```markdown
## Daily Operations

### Health Check
1. Verify Vault cluster status: `vault status`
2. Check seal status: All nodes should be unsealed
3. Review audit log volume: Alert if > 2x normal

### Weekly Operations
1. Review access audit reports
2. Verify rotation schedules are executing
3. Test emergency rotation procedure

### Monthly Operations
1. Generate compliance report
2. Review and update access policies
3. Rotate static secrets
4. Test disaster recovery procedures
```

---

## Appendices

### A. Secret Naming Convention

```
secret/data/{environment}/{service}/{category}/{name}

Examples:
- secret/data/production/authz-engine/database/postgres
- secret/data/production/authz-engine/api-keys/stripe
- secret/data/staging/authz-engine/jwt/signing-key
```

### B. Related Documents

| Document | Description |
|----------|-------------|
| [DISASTER-RECOVERY-SDD](./DISASTER-RECOVERY-SDD.md) | Disaster recovery procedures |
| [AUDIT-LOGGING-SDD](./AUDIT-LOGGING-SDD.md) | Audit logging implementation |
| [DEPLOYMENT-OPERATIONS-SDD](./DEPLOYMENT-OPERATIONS-SDD.md) | Kubernetes deployment |
| [GRPC-CLIENT-SDD](./GRPC-CLIENT-SDD.md) | mTLS configuration |

---

**Document Control:**
- **Review Cycle:** Quarterly
- **Security Classification:** Confidential
- **Distribution:** Engineering, Security, Operations Teams
