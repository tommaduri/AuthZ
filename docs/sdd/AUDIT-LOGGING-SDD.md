# Software Design Document: Audit Logging

**Version**: 1.0.0
**Package**: `@authz-engine/server`
**Status**: Specification
**Last Updated**: 2025-11-23

---

## 1. Overview

### 1.1 Purpose

This document defines the compliance-grade audit logging system for the AuthZ Engine, providing tamper-proof, searchable audit trails for all authorization decisions and administrative actions.

### 1.2 Compliance Requirements

| Standard | Requirement | Implementation |
|----------|-------------|----------------|
| SOC 2 | Audit trail for all access | All decisions logged |
| HIPAA | 6-year retention | Lifecycle policies |
| PCI-DSS | Access logging | Principal tracking |
| GDPR | Right to access/erasure | Export/anonymization |
| FedRAMP | Tamper-proof logs | Hash chaining |

---

## 2. Architecture

### 2.1 Audit Pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Audit Logging Pipeline                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐      │
│  │ Decision │───►│  Audit   │───►│  Buffer  │───►│ Storage  │      │
│  │  Engine  │    │  Logger  │    │ (Batch)  │    │ Backend  │      │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘      │
│                                                                      │
│  Event Types:                Storage Tiers:                         │
│  ├── authorization_decision   ├── Hot: Elasticsearch (30 days)     │
│  ├── policy_change            ├── Warm: S3 Standard-IA (1 year)    │
│  ├── admin_action             └── Cold: S3 Glacier (7 years)       │
│  ├── system_event                                                   │
│  └── security_alert          Exports:                               │
│                              ├── SIEM (Splunk, Datadog)             │
│                              ├── Syslog                              │
│                              └── Webhook                             │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Audit Event Model

### 3.1 Event Schema

```typescript
interface AuditEvent {
  // Identity
  id: string;                    // UUID v7 (time-sortable)
  timestamp: string;             // ISO 8601
  version: '1.0';

  // Classification
  type: AuditEventType;
  category: AuditCategory;
  severity: AuditSeverity;

  // Context
  tenant: string;
  requestId: string;
  correlationId?: string;
  traceId?: string;
  spanId?: string;

  // Actor
  actor: {
    type: 'principal' | 'service' | 'system';
    id: string;
    roles?: string[];
    ip?: string;
    userAgent?: string;
  };

  // Target
  target?: {
    type: string;
    id: string;
    attributes?: Record<string, unknown>;
  };

  // Action
  action: string;
  outcome: 'success' | 'failure' | 'error';

  // Details
  details: Record<string, unknown>;

  // Integrity
  hash?: string;              // SHA-256 of event
  previousHash?: string;      // Chain to previous event
}

enum AuditEventType {
  AUTHORIZATION_CHECK = 'authorization.check',
  AUTHORIZATION_BATCH = 'authorization.batch',
  POLICY_CREATED = 'policy.created',
  POLICY_UPDATED = 'policy.updated',
  POLICY_DELETED = 'policy.deleted',
  ADMIN_LOGIN = 'admin.login',
  ADMIN_ACTION = 'admin.action',
  SYSTEM_STARTUP = 'system.startup',
  SYSTEM_SHUTDOWN = 'system.shutdown',
  SECURITY_ALERT = 'security.alert',
}

enum AuditCategory {
  AUTHORIZATION = 'authorization',
  POLICY = 'policy',
  ADMIN = 'admin',
  SYSTEM = 'system',
  SECURITY = 'security',
}

enum AuditSeverity {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  CRITICAL = 'critical',
}
```

### 3.2 Authorization Decision Event

```typescript
interface AuthorizationAuditEvent extends AuditEvent {
  type: 'authorization.check';
  details: {
    principal: {
      id: string;
      roles: string[];
    };
    resource: {
      kind: string;
      id: string;
    };
    action: string;
    decision: 'ALLOW' | 'DENY';
    matchedPolicy?: string;
    derivedRoles?: string[];
    evaluationTimeMs: number;
    cached: boolean;
  };
}
```

---

## 4. Tamper Protection

### 4.1 Hash Chaining

```typescript
import { createHash } from 'crypto';

class HashChain {
  private lastHash: string = '0'.repeat(64);

  computeHash(event: AuditEvent): string {
    const payload = JSON.stringify({
      id: event.id,
      timestamp: event.timestamp,
      type: event.type,
      actor: event.actor,
      action: event.action,
      outcome: event.outcome,
      details: event.details,
      previousHash: this.lastHash,
    });

    const hash = createHash('sha256').update(payload).digest('hex');
    this.lastHash = hash;

    return hash;
  }

  verifyChain(events: AuditEvent[]): VerificationResult {
    let previousHash = '0'.repeat(64);
    const issues: string[] = [];

    for (const event of events) {
      if (event.previousHash !== previousHash) {
        issues.push(`Chain break at event ${event.id}`);
      }

      const computedHash = this.computeEventHash(event);
      if (event.hash !== computedHash) {
        issues.push(`Hash mismatch at event ${event.id}`);
      }

      previousHash = event.hash!;
    }

    return {
      valid: issues.length === 0,
      issues,
      eventsVerified: events.length,
    };
  }
}
```

### 4.2 Digital Signatures

```typescript
import { sign, verify } from 'crypto';

class AuditSigner {
  private privateKey: string;
  private publicKey: string;

  signEvent(event: AuditEvent): string {
    const data = JSON.stringify(event);
    return sign('sha256', Buffer.from(data), this.privateKey).toString('base64');
  }

  verifySignature(event: AuditEvent, signature: string): boolean {
    const data = JSON.stringify(event);
    return verify('sha256', Buffer.from(data), this.publicKey, Buffer.from(signature, 'base64'));
  }
}
```

---

## 5. Storage Backends

### 5.1 Elasticsearch (Hot Storage)

```typescript
interface ElasticsearchConfig {
  nodes: string[];
  index: {
    prefix: 'authz-audit';
    rollover: 'daily' | 'weekly';
    shards: 3;
    replicas: 1;
  };
  retention: '30d';
}

class ElasticsearchBackend implements AuditBackend {
  async write(events: AuditEvent[]): Promise<void> {
    const body = events.flatMap(event => [
      { index: { _index: this.getIndex(event) } },
      event,
    ]);

    await this.client.bulk({ body, refresh: false });
  }

  async search(query: AuditQuery): Promise<AuditEvent[]> {
    const result = await this.client.search({
      index: `${this.config.index.prefix}-*`,
      body: this.buildQuery(query),
    });

    return result.hits.hits.map(hit => hit._source as AuditEvent);
  }

  private getIndex(event: AuditEvent): string {
    const date = event.timestamp.split('T')[0];
    return `${this.config.index.prefix}-${date}`;
  }
}
```

### 5.2 S3 (Warm/Cold Storage)

```typescript
interface S3BackendConfig {
  bucket: string;
  prefix: string;
  compression: 'gzip' | 'zstd';
  encryption: {
    type: 'SSE-S3' | 'SSE-KMS';
    kmsKeyId?: string;
  };
  lifecycle: {
    transitionToIA: 30;      // days
    transitionToGlacier: 365; // days
    expiration: 2555;         // 7 years
  };
}

class S3Backend implements AuditBackend {
  async archive(events: AuditEvent[]): Promise<void> {
    const date = new Date().toISOString().split('T')[0];
    const key = `${this.config.prefix}/${date}/${Date.now()}.jsonl.gz`;

    const data = events.map(e => JSON.stringify(e)).join('\n');
    const compressed = await this.compress(data);

    await this.s3.putObject({
      Bucket: this.config.bucket,
      Key: key,
      Body: compressed,
      ContentEncoding: 'gzip',
      ServerSideEncryption: this.config.encryption.type,
      SSEKMSKeyId: this.config.encryption.kmsKeyId,
    });
  }
}
```

---

## 6. SIEM Integration

### 6.1 Splunk

```typescript
interface SplunkConfig {
  endpoint: string;
  token: string;
  index: string;
  sourcetype: 'authz:audit';
}

class SplunkExporter implements AuditExporter {
  async export(events: AuditEvent[]): Promise<void> {
    const payload = events.map(event => ({
      event,
      time: new Date(event.timestamp).getTime() / 1000,
      source: 'authz-engine',
      sourcetype: this.config.sourcetype,
      index: this.config.index,
    }));

    await fetch(this.config.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Splunk ${this.config.token}`,
        'Content-Type': 'application/json',
      },
      body: payload.map(p => JSON.stringify(p)).join('\n'),
    });
  }
}
```

### 6.2 Datadog

```typescript
interface DatadogConfig {
  apiKey: string;
  site: 'datadoghq.com' | 'datadoghq.eu';
  service: 'authz-engine';
  source: 'authz';
}

class DatadogExporter implements AuditExporter {
  async export(events: AuditEvent[]): Promise<void> {
    const logs = events.map(event => ({
      ddsource: this.config.source,
      ddtags: `env:${process.env.NODE_ENV},service:${this.config.service}`,
      hostname: os.hostname(),
      message: JSON.stringify(event),
      service: this.config.service,
      status: event.severity,
    }));

    await fetch(`https://http-intake.logs.${this.config.site}/api/v2/logs`, {
      method: 'POST',
      headers: {
        'DD-API-KEY': this.config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(logs),
    });
  }
}
```

### 6.3 Syslog

```typescript
class SyslogExporter implements AuditExporter {
  async export(events: AuditEvent[]): Promise<void> {
    for (const event of events) {
      const priority = this.getPriority(event.severity);
      const message = this.formatCEF(event);

      await this.sendUDP(this.config.host, this.config.port, `<${priority}>${message}`);
    }
  }

  private formatCEF(event: AuditEvent): string {
    return [
      'CEF:0',
      'AuthZ Engine',
      'AuthZ',
      '1.0',
      event.type,
      event.action,
      this.getSeverityNumber(event.severity),
      `msg=${JSON.stringify(event.details)}`,
    ].join('|');
  }
}
```

---

## 7. Search & Query

### 7.1 Query DSL

```typescript
interface AuditQuery {
  // Time range
  from: string;              // ISO 8601
  to: string;

  // Filters
  filters?: {
    types?: AuditEventType[];
    categories?: AuditCategory[];
    severities?: AuditSeverity[];
    actors?: string[];
    targets?: string[];
    outcomes?: ('success' | 'failure' | 'error')[];
    tenants?: string[];
  };

  // Full-text search
  search?: string;

  // Pagination
  limit?: number;
  offset?: number;

  // Sorting
  sort?: {
    field: string;
    order: 'asc' | 'desc';
  };
}

// Example queries
const recentDenials: AuditQuery = {
  from: '2024-01-01T00:00:00Z',
  to: '2024-01-02T00:00:00Z',
  filters: {
    types: ['authorization.check'],
    outcomes: ['failure'],
  },
  sort: { field: 'timestamp', order: 'desc' },
  limit: 100,
};

const adminActions: AuditQuery = {
  from: '2024-01-01T00:00:00Z',
  to: '2024-01-02T00:00:00Z',
  filters: {
    categories: ['admin'],
  },
};
```

### 7.2 Search API

```typescript
// REST API
// GET /v1/audit/search
// POST /v1/audit/search

interface AuditSearchResponse {
  events: AuditEvent[];
  total: number;
  hasMore: boolean;
  aggregations?: {
    byType: Record<string, number>;
    byOutcome: Record<string, number>;
    byHour: { hour: string; count: number }[];
  };
}
```

---

## 8. Retention & Lifecycle

### 8.1 Retention Policies

```yaml
retention:
  policies:
    - name: authorization_events
      types: ['authorization.*']
      hot: 30d          # Elasticsearch
      warm: 365d        # S3 Standard-IA
      cold: 2555d       # S3 Glacier (7 years)

    - name: admin_events
      types: ['admin.*', 'policy.*']
      hot: 90d
      warm: 365d
      cold: 2555d

    - name: security_events
      types: ['security.*']
      hot: 365d         # Keep security events hot longer
      warm: 730d
      cold: 2555d
```

### 8.2 Legal Hold

```typescript
interface LegalHold {
  id: string;
  name: string;
  createdAt: string;
  createdBy: string;
  query: AuditQuery;       // Events matching this query are preserved
  expiresAt?: string;      // Optional expiration
}

class LegalHoldService {
  async createHold(hold: LegalHold): Promise<void> {
    // Mark matching events as under legal hold
    await this.auditStore.tagEvents(hold.query, { legalHold: hold.id });

    // Prevent deletion of these events
    await this.lifecycleService.excludeFromDeletion(hold.query);
  }

  async releaseHold(holdId: string): Promise<void> {
    // Remove legal hold tag
    // Events can now follow normal lifecycle
  }
}
```

---

## 9. Access Control

### 9.1 Permissions

| Permission | Description | Roles |
|------------|-------------|-------|
| `audit:read` | View audit events | Auditor, Admin |
| `audit:search` | Search audit logs | Auditor, Admin |
| `audit:export` | Export audit data | Auditor, Admin |
| `audit:admin` | Manage retention | Admin only |

### 9.2 Data Masking

```typescript
interface MaskingConfig {
  fields: {
    'actor.ip': 'partial';           // 192.168.xxx.xxx
    'details.principal.attr': 'hash'; // SHA-256 hash
  };
  roles: {
    auditor: ['actor.ip'];           // Fields masked for auditor role
  };
}

class DataMasker {
  mask(event: AuditEvent, role: string): AuditEvent {
    const fieldsToMask = this.config.roles[role] || [];
    const masked = { ...event };

    for (const field of fieldsToMask) {
      const strategy = this.config.fields[field];
      masked[field] = this.applyMasking(event[field], strategy);
    }

    return masked;
  }
}
```

---

## 10. Performance

### 10.1 Async Logging

```typescript
class AsyncAuditLogger {
  private buffer: AuditEvent[] = [];
  private flushInterval: NodeJS.Timeout;

  constructor(private config: AuditConfig) {
    this.flushInterval = setInterval(
      () => this.flush(),
      config.flushIntervalMs
    );
  }

  log(event: AuditEvent): void {
    // Non-blocking - add to buffer
    this.buffer.push(event);

    // Flush if buffer full
    if (this.buffer.length >= this.config.batchSize) {
      this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const events = this.buffer.splice(0, this.buffer.length);

    // Write to all backends in parallel
    await Promise.all([
      this.elasticsearch.write(events),
      this.s3.archive(events),
      ...this.exporters.map(e => e.export(events)),
    ]);
  }
}
```

### 10.2 Sampling

```typescript
interface SamplingConfig {
  enabled: boolean;
  rules: SamplingRule[];
  defaultRate: number;  // 1.0 = 100%
}

interface SamplingRule {
  match: {
    type?: AuditEventType;
    outcome?: string;
  };
  rate: number;
}

// Sample 10% of successful auth checks, 100% of failures
const samplingConfig: SamplingConfig = {
  enabled: true,
  defaultRate: 1.0,
  rules: [
    { match: { type: 'authorization.check', outcome: 'success' }, rate: 0.1 },
    { match: { type: 'authorization.check', outcome: 'failure' }, rate: 1.0 },
  ],
};
```

---

## 11. Configuration

```yaml
audit:
  enabled: true

  # Buffering
  buffer:
    size: 1000
    flushIntervalMs: 5000

  # Backends
  backends:
    elasticsearch:
      enabled: true
      nodes: ['http://elasticsearch:9200']
      index:
        prefix: authz-audit
        rollover: daily

    s3:
      enabled: true
      bucket: authz-audit-logs
      region: us-east-1
      encryption:
        type: SSE-KMS
        kmsKeyId: alias/authz-audit

  # Exporters
  exporters:
    splunk:
      enabled: false
      endpoint: https://splunk.example.com:8088
      token: ${SPLUNK_HEC_TOKEN}

    datadog:
      enabled: true
      apiKey: ${DD_API_KEY}
      site: datadoghq.com

  # Retention
  retention:
    hot: 30d
    warm: 365d
    cold: 2555d

  # Integrity
  integrity:
    hashChain: true
    signatures: false  # Enable for highest compliance

  # Sampling (production only)
  sampling:
    enabled: false
    defaultRate: 1.0
```

---

## 12. Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| @elastic/elasticsearch | ^8.10.0 | Elasticsearch client |
| @aws-sdk/client-s3 | ^3.400.0 | S3 storage |
| pino | ^8.16.2 | Structured logging |

---

*Last Updated: 2025-11-23*
