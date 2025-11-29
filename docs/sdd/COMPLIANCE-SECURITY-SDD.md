# Software Design Document: Compliance and Security

**Version**: 1.0.0
**Package**: `@authz-engine/server`, `@authz-engine/core`
**Status**: Specification (Not Yet Implemented)
**Last Updated**: 2025-11-23

---

## 1. Overview

### 1.1 Purpose

The Compliance and Security module ensures the AuthZ Engine meets regulatory requirements and security best practices. This includes:
- Multi-framework compliance support (HIPAA, PCI-DSS, SOC 2, GDPR, FedRAMP)
- Comprehensive audit logging with PII masking
- Secure authentication and authorization (meta-authorization)
- Encryption at rest and in transit
- Decision explanation for regulatory transparency

### 1.2 Scope

**In Scope:**
- Compliance framework configuration and reporting
- Audit record generation and storage
- PII masking and data minimization
- Authentication mechanisms (mTLS, API keys, JWT)
- Admin API access control (meta-authorization)
- Encryption configuration
- Security testing guidelines

**Out of Scope:**
- External compliance auditing tools
- SOC 2 certification process
- Data residency management
- Key Management Service (KMS) implementation

### 1.3 Key Decisions

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Multi-framework support | Enterprises need multiple certifications | Single framework only |
| Audit to Kafka | Scalable, durable, queryable | File-only, database |
| PII masking at source | Prevents leakage early | Post-processing |
| CEL expression redaction | Conditions can leak sensitive logic | Full logging |

---

## 2. Compliance Frameworks

### 2.1 HIPAA (Health Insurance Portability and Accountability Act)

| Control | Requirement | AuthZ Engine Implementation |
|---------|-------------|----------------------------|
| Access Control (164.312(a)) | Unique user identification | Principal ID in all requests |
| Audit Controls (164.312(b)) | Record and examine activity | Decision audit logs with timestamps |
| Integrity (164.312(c)) | PHI protection | PII masking in audit logs |
| Transmission Security (164.312(e)) | Encryption in transit | TLS 1.3 required |

**PHI Handling Considerations:**
- Never store PHI in policy conditions
- Mask attributes like `email`, `ssn`, `mrn` in audit logs
- Retain audit logs for minimum 6 years

### 2.2 PCI-DSS (Payment Card Industry Data Security Standard)

| Requirement | Description | AuthZ Engine Implementation |
|-------------|-------------|----------------------------|
| Req 7 | Restrict access to CHD | Explicit deny-by-default policies |
| Req 8 | Unique user IDs | Principal ID tracking |
| Req 10.1 | Audit trails | Decision logging with user attribution |
| Req 10.2 | Log all access | Comprehensive audit records |
| Req 10.3 | Audit entry format | Structured JSON with required fields |
| Req 10.5 | Secure audit trails | Audit log encryption and integrity |
| Req 10.7 | 1 year retention | Configurable retention policies |

### 2.3 SOC 2 (Service Organization Control 2)

| Trust Criteria | Category | AuthZ Engine Support |
|----------------|----------|---------------------|
| CC6.1 | Security - Logical Access | Policy-based authorization |
| CC6.2 | Security - System Boundaries | Network isolation, mTLS |
| CC6.3 | Security - System Credentials | API key rotation, JWT validation |
| CC6.6 | Security - Threat Detection | Agent anomaly detection |
| CC6.7 | Security - Vulnerability Management | Security scanning integration |
| A1.1 | Availability - Capacity | Health checks, load balancing |
| PI1.1 | Processing Integrity - Accuracy | Decision consistency guarantees |

### 2.4 GDPR (General Data Protection Regulation)

| Article | Requirement | AuthZ Engine Implementation |
|---------|-------------|----------------------------|
| Art 5(1)(b) | Purpose limitation | Audit logs only for security/compliance |
| Art 5(1)(c) | Data minimization | PII masking, configurable detail levels |
| Art 22 | Right to explanation | Decision explanation API |
| Art 17 | Right to erasure | Audit log retention policies |
| Art 30 | Records of processing | Structured audit logs |

### 2.5 FedRAMP (Federal Risk and Authorization Management Program)

| Control Family | Control | AuthZ Engine Support |
|----------------|---------|---------------------|
| AC (Access Control) | AC-2, AC-3, AC-6 | RBAC, least privilege |
| AU (Audit) | AU-2, AU-3, AU-6 | Comprehensive audit logging |
| IA (Identification) | IA-2, IA-5 | Principal verification, API keys |
| SC (System Comms) | SC-8, SC-13 | TLS 1.3, encryption |

---

## 3. TypeScript Interfaces

### 3.1 Compliance Configuration

```typescript
interface ComplianceConfig {
  /** Enabled compliance frameworks */
  frameworks: ComplianceFramework[];
  /** Audit log retention in days */
  auditRetention: number;
  /** Enable PII masking in audit logs */
  piiMasking: boolean;
  /** Enable decision explanation for GDPR Art 22 */
  decisionExplanation: boolean;
  /** Framework-specific settings */
  frameworkSettings?: FrameworkSettings;
}

type ComplianceFramework = 'hipaa' | 'pci-dss' | 'soc2' | 'gdpr' | 'fedramp';

interface FrameworkSettings {
  hipaa?: {
    minRetentionYears: number;       // Default: 6
    phiAttributes: string[];          // Attributes to mask
  };
  pciDss?: {
    minRetentionYears: number;       // Default: 1
    cardholderDataMask: boolean;
  };
  gdpr?: {
    enableExplanations: boolean;
    dataSubjectIdField: string;       // Field identifying data subject
    retentionDays: number;
  };
  fedramp?: {
    impactLevel: 'low' | 'moderate' | 'high';
    auditFrequency: 'continuous' | 'daily' | 'weekly';
  };
}
```

### 3.2 Compliance Reporting

```typescript
interface ComplianceReport {
  /** Framework being assessed */
  framework: ComplianceFramework;
  /** Individual control assessments */
  controls: ControlAssessment[];
  /** Overall compliance status */
  overallStatus: 'compliant' | 'non-compliant' | 'needs-review';
  /** Report generation timestamp */
  generatedAt: Date;
  /** Assessment period */
  assessmentPeriod: {
    start: Date;
    end: Date;
  };
  /** Assessor information */
  assessedBy?: string;
}

interface ControlAssessment {
  /** Control identifier (e.g., "164.312(a)" for HIPAA) */
  controlId: string;
  /** Human-readable control name */
  controlName: string;
  /** Implementation status */
  status: 'implemented' | 'partial' | 'not-implemented';
  /** Evidence of implementation */
  evidence: string[];
  /** Identified gaps */
  gaps: string[];
  /** Remediation recommendations */
  remediation?: string[];
  /** Last assessment date */
  lastAssessed: Date;
}
```

### 3.3 Audit Records

```typescript
interface AuditRecord {
  /** Unique audit record identifier */
  id: string;
  /** When the decision was made */
  timestamp: Date;
  /** Correlation ID for request tracing */
  requestId: string;
  /** Principal information (masked if configured) */
  principal: PrincipalAuditInfo;
  /** Resource information */
  resource: ResourceAuditInfo;
  /** Action requested */
  action: string;
  /** Authorization decision */
  decision: 'allow' | 'deny';
  /** Human-readable reason (for GDPR) */
  reason?: string;
  /** Policies that matched */
  policyIds: string[];
  /** Additional context */
  metadata: AuditMetadata;
}

interface PrincipalAuditInfo {
  /** Principal identifier */
  id: string;
  /** Roles (may be derived) */
  roles: string[];
  /** Masked attributes */
  attributes?: Record<string, unknown>;
  /** Source of authentication */
  authMethod?: 'mtls' | 'jwt' | 'api-key';
}

interface ResourceAuditInfo {
  /** Resource type */
  kind: string;
  /** Resource identifier */
  id: string;
  /** Resource scope/tenant */
  scope?: string;
  /** Masked attributes */
  attributes?: Record<string, unknown>;
}

interface AuditMetadata {
  /** Server version */
  serverVersion: string;
  /** Request source IP (if allowed) */
  sourceIp?: string;
  /** Evaluation duration in ms */
  evaluationDurationMs: number;
  /** Number of policies evaluated */
  policiesEvaluated: number;
  /** Derived roles computed */
  derivedRoles?: string[];
  /** CEL conditions evaluated (count only, not content) */
  conditionsEvaluated: number;
  /** Tenant/scope context */
  tenant?: string;
}
```

---

## 4. Security Features

### 4.1 Authentication

#### 4.1.1 mTLS for gRPC

```typescript
interface MTLSConfig {
  enabled: boolean;
  /** CA certificate for client verification */
  caCertPath: string;
  /** Server certificate */
  serverCertPath: string;
  /** Server private key */
  serverKeyPath: string;
  /** Require client certificate */
  requireClientCert: boolean;
  /** Certificate verification mode */
  verifyMode: 'none' | 'optional' | 'require';
  /** Allowed client certificate CNs */
  allowedCNs?: string[];
}
```

#### 4.1.2 API Key Management

```typescript
interface ApiKeyConfig {
  enabled: boolean;
  /** Header name for API key */
  headerName: string;  // Default: "X-API-Key"
  /** Hash algorithm for stored keys */
  hashAlgorithm: 'sha256' | 'sha512' | 'argon2';
  /** Key rotation settings */
  rotation: {
    enabled: boolean;
    maxAgeDays: number;
    warningDays: number;
  };
}

interface ApiKey {
  id: string;
  /** Hashed key value (never store plain) */
  hashedKey: string;
  /** Descriptive name */
  name: string;
  /** Associated scopes/permissions */
  scopes: string[];
  /** Creation timestamp */
  createdAt: Date;
  /** Expiration timestamp */
  expiresAt?: Date;
  /** Last used timestamp */
  lastUsedAt?: Date;
  /** Created by */
  createdBy: string;
}
```

#### 4.1.3 JWT Validation

```typescript
interface JWTConfig {
  enabled: boolean;
  /** JWKS URI for key discovery */
  jwksUri?: string;
  /** Static public key (alternative to JWKS) */
  publicKey?: string;
  /** Expected issuer */
  issuer: string;
  /** Expected audience */
  audience: string | string[];
  /** Clock skew tolerance in seconds */
  clockSkewSeconds: number;
  /** Claim mappings */
  claims: {
    /** Claim for principal ID */
    subjectClaim: string;       // Default: "sub"
    /** Claim for roles */
    rolesClaim: string;         // Default: "roles"
    /** Claim for tenant */
    tenantClaim?: string;
  };
}
```

### 4.2 Meta-Authorization (Admin API Access)

```typescript
interface MetaAuthorizationConfig {
  enabled: boolean;
  /** Policy for admin operations */
  adminPolicy: AdminAccessPolicy;
  /** Separate auth for admin API */
  adminAuth: {
    /** Require specific roles */
    requiredRoles: string[];
    /** Require specific scopes */
    requiredScopes: string[];
    /** IP allowlist */
    allowedIps?: string[];
  };
}

interface AdminAccessPolicy {
  /** Who can modify policies */
  policyModification: {
    allowedPrincipals: string[];
    requireApproval: boolean;
  };
  /** Who can access audit logs */
  auditAccess: {
    allowedPrincipals: string[];
    allowedScopes: string[];
  };
  /** Who can manage API keys */
  apiKeyManagement: {
    allowedPrincipals: string[];
  };
}

/** Admin operations requiring authorization */
type AdminOperation =
  | 'policy:create'
  | 'policy:update'
  | 'policy:delete'
  | 'policy:read'
  | 'audit:read'
  | 'audit:export'
  | 'apikey:create'
  | 'apikey:revoke'
  | 'config:read'
  | 'config:update';
```

### 4.3 Encryption

```typescript
interface EncryptionConfig {
  /** At-rest encryption for policies */
  atRest: {
    enabled: boolean;
    algorithm: 'aes-256-gcm' | 'chacha20-poly1305';
    /** KMS key reference or local key path */
    keyReference: string;
    /** Key rotation interval */
    rotationDays?: number;
  };
  /** In-transit encryption */
  inTransit: {
    /** Minimum TLS version */
    minTlsVersion: '1.2' | '1.3';
    /** Preferred cipher suites */
    cipherSuites?: string[];
    /** Enable HSTS */
    hsts: boolean;
  };
  /** Audit log encryption */
  auditLogs: {
    enabled: boolean;
    /** Separate key for audit logs */
    keyReference: string;
  };
}
```

---

## 5. Audit Logging Configuration

### 5.1 YAML Configuration

```yaml
# config.yaml
audit:
  enabled: true
  backend: kafka  # file, stdout, kafka, custom
  retention: 90   # days

  # PII Masking Configuration
  piiMasking:
    enabled: true
    maskChar: "*"
    preserveLength: false
    fields:
      - principal.attr.email
      - principal.attr.ssn
      - principal.attr.phone
      - principal.attr.dob
      - resource.attr.patient_id
      - resource.attr.card_number

  # Output format
  format: json

  # Include policy names in audit
  includePolicy: true

  # Exclude CEL expressions (can leak sensitive logic)
  includeConditions: false

  # File backend settings
  file:
    path: /var/log/authz-engine/audit.log
    maxSizeMB: 100
    maxFiles: 30
    compress: true

  # Kafka backend settings
  kafka:
    brokers:
      - kafka-1:9092
      - kafka-2:9092
    topic: authz-audit
    clientId: authz-engine
    compression: gzip
    acks: all  # Ensure durability

  # Filtering
  filter:
    # Only log denied decisions (reduce volume)
    decisionsOnly: false
    # Exclude health check requests
    excludePaths:
      - /health/*
      - /metrics
    # Only log specific resources
    includeResources: []  # Empty = all
```

### 5.2 PII Masking Implementation

```typescript
interface PiiMaskingConfig {
  enabled: boolean;
  maskChar: string;
  preserveLength: boolean;
  fields: string[];
  customMaskers?: Record<string, PiiMasker>;
}

type PiiMasker = (value: unknown) => unknown;

class AuditPiiMasker {
  private config: PiiMaskingConfig;
  private fieldPaths: Set<string>;

  constructor(config: PiiMaskingConfig) {
    this.config = config;
    this.fieldPaths = new Set(config.fields);
  }

  mask(record: AuditRecord): AuditRecord {
    if (!this.config.enabled) return record;

    const masked = structuredClone(record);

    // Mask principal attributes
    if (masked.principal.attributes) {
      masked.principal.attributes = this.maskObject(
        masked.principal.attributes,
        'principal.attr'
      );
    }

    // Mask resource attributes
    if (masked.resource.attributes) {
      masked.resource.attributes = this.maskObject(
        masked.resource.attributes,
        'resource.attr'
      );
    }

    return masked;
  }

  private maskObject(
    obj: Record<string, unknown>,
    prefix: string
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      const fieldPath = `${prefix}.${key}`;

      if (this.fieldPaths.has(fieldPath)) {
        result[key] = this.maskValue(value, fieldPath);
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.maskObject(
          value as Record<string, unknown>,
          fieldPath
        );
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  private maskValue(value: unknown, fieldPath: string): unknown {
    // Check for custom masker
    const customMasker = this.config.customMaskers?.[fieldPath];
    if (customMasker) {
      return customMasker(value);
    }

    // Default string masking
    if (typeof value === 'string') {
      if (this.config.preserveLength) {
        return this.config.maskChar.repeat(value.length);
      }
      return this.config.maskChar.repeat(8);  // Fixed length
    }

    // Mask other types
    return '[REDACTED]';
  }
}
```

---

## 6. Decision Explanation (GDPR Art 22)

### 6.1 Explained Decision Interface

```typescript
interface ExplainedDecision {
  /** The authorization effect */
  effect: 'allow' | 'deny';
  /** Detailed explanation */
  explanation: DecisionExplanation;
  /** Request details */
  request: {
    principalId: string;
    resourceKind: string;
    resourceId: string;
    action: string;
  };
  /** Timestamp of decision */
  timestamp: Date;
}

interface DecisionExplanation {
  /** Policies that matched and their contribution */
  matchedPolicies: PolicyMatch[];
  /** Conditions that were evaluated */
  evaluatedConditions: ConditionEvaluation[];
  /** Derived roles that were computed */
  derivedRoles: DerivedRoleExplanation[];
  /** Human-readable explanation */
  humanReadable: string;
  /** Path to allow (if denied) */
  pathToAllow?: PathToAllow;
}

interface PolicyMatch {
  /** Policy identifier */
  policyId: string;
  /** Policy name */
  policyName: string;
  /** Version of the policy */
  version: string;
  /** Effect from this policy */
  effect: 'allow' | 'deny' | 'no-match';
  /** Why this policy matched or didn't */
  matchReason: string;
  /** Rule within policy that matched */
  matchedRule?: string;
}

interface ConditionEvaluation {
  /** Condition identifier */
  conditionId: string;
  /** Result of evaluation */
  result: boolean;
  /** Reason (without revealing sensitive CEL) */
  reason: string;
  /** Variables used (names only, not values) */
  variablesUsed: string[];
}

interface DerivedRoleExplanation {
  /** Derived role name */
  roleName: string;
  /** Whether the role was granted */
  granted: boolean;
  /** Why the role was/wasn't granted */
  reason: string;
  /** Parent roles that contributed */
  parentRoles: string[];
}

interface PathToAllow {
  /** What changes would allow access */
  suggestions: AllowSuggestion[];
  /** Confidence in suggestions */
  confidence: 'high' | 'medium' | 'low';
}

interface AllowSuggestion {
  /** Type of change */
  type: 'add-role' | 'add-attribute' | 'different-action' | 'policy-change';
  /** Description of change */
  description: string;
  /** Specific details */
  details: Record<string, unknown>;
}
```

### 6.2 Explanation Generator

```typescript
class DecisionExplainer {
  private config: ExplainerConfig;

  constructor(config: ExplainerConfig) {
    this.config = config;
  }

  explain(
    request: CheckRequest,
    result: CheckResult,
    evaluationTrace: EvaluationTrace
  ): ExplainedDecision {
    const matchedPolicies = this.explainPolicyMatches(
      evaluationTrace.policyEvaluations
    );

    const evaluatedConditions = this.explainConditions(
      evaluationTrace.conditionEvaluations
    );

    const derivedRoles = this.explainDerivedRoles(
      evaluationTrace.derivedRoleEvaluations
    );

    const humanReadable = this.generateHumanReadable(
      result.effect,
      matchedPolicies,
      derivedRoles
    );

    const pathToAllow = result.effect === 'deny'
      ? this.computePathToAllow(request, evaluationTrace)
      : undefined;

    return {
      effect: result.effect,
      explanation: {
        matchedPolicies,
        evaluatedConditions,
        derivedRoles,
        humanReadable,
        pathToAllow,
      },
      request: {
        principalId: request.principal.id,
        resourceKind: request.resource.kind,
        resourceId: request.resource.id,
        action: request.action,
      },
      timestamp: new Date(),
    };
  }

  private generateHumanReadable(
    effect: 'allow' | 'deny',
    policies: PolicyMatch[],
    roles: DerivedRoleExplanation[]
  ): string {
    if (effect === 'allow') {
      const allowingPolicy = policies.find(p => p.effect === 'allow');
      const grantedRoles = roles.filter(r => r.granted).map(r => r.roleName);

      return `Access was ALLOWED by policy "${allowingPolicy?.policyName}". ` +
        (grantedRoles.length > 0
          ? `Principal has roles: ${grantedRoles.join(', ')}.`
          : '');
    } else {
      const denyingPolicy = policies.find(p => p.effect === 'deny');

      if (denyingPolicy) {
        return `Access was DENIED by explicit deny in policy "${denyingPolicy.policyName}". ` +
          `Reason: ${denyingPolicy.matchReason}`;
      }

      return `Access was DENIED because no policy granted permission for this action. ` +
        `Evaluated ${policies.length} policies.`;
    }
  }

  private computePathToAllow(
    request: CheckRequest,
    trace: EvaluationTrace
  ): PathToAllow {
    const suggestions: AllowSuggestion[] = [];

    // Check if adding a role would help
    const roleGaps = trace.policyEvaluations
      .filter(p => p.requiredRoles?.length > 0)
      .flatMap(p => p.requiredRoles!)
      .filter(r => !request.principal.roles.includes(r));

    if (roleGaps.length > 0) {
      suggestions.push({
        type: 'add-role',
        description: `Adding one of these roles would grant access: ${roleGaps.join(', ')}`,
        details: { roles: roleGaps },
      });
    }

    // Check for failed conditions
    const failedConditions = trace.conditionEvaluations
      .filter(c => !c.result);

    if (failedConditions.length > 0) {
      suggestions.push({
        type: 'add-attribute',
        description: 'Some policy conditions were not met',
        details: {
          conditions: failedConditions.map(c => c.conditionId),
        },
      });
    }

    return {
      suggestions,
      confidence: suggestions.length > 0 ? 'high' : 'low',
    };
  }
}
```

---

## 7. Secure Deployment Patterns

### 7.1 Network Isolation

```yaml
# Kubernetes NetworkPolicy
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: authz-engine-policy
spec:
  podSelector:
    matchLabels:
      app: authz-engine
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: application
        - podSelector:
            matchLabels:
              authz-client: "true"
      ports:
        - protocol: TCP
          port: 3592  # REST
        - protocol: TCP
          port: 3593  # gRPC
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              name: monitoring
      ports:
        - protocol: TCP
          port: 9092  # Kafka for audit
```

### 7.2 Secrets Management

```typescript
interface SecretsConfig {
  /** Secrets provider */
  provider: 'env' | 'vault' | 'aws-sm' | 'gcp-sm' | 'azure-kv';

  /** Vault configuration */
  vault?: {
    address: string;
    authMethod: 'token' | 'kubernetes' | 'approle';
    secretPath: string;
    renewInterval: number;
  };

  /** AWS Secrets Manager */
  awsSecretsManager?: {
    region: string;
    secretId: string;
    roleArn?: string;
  };

  /** Required secrets */
  secrets: {
    tlsCertificate: string;
    tlsPrivateKey: string;
    encryptionKey: string;
    apiKeySecret: string;
    jwtPublicKey?: string;
  };
}
```

### 7.3 Certificate Rotation

```typescript
interface CertificateRotationConfig {
  enabled: boolean;
  /** Check interval for expiring certs */
  checkIntervalHours: number;
  /** Days before expiry to trigger renewal */
  renewalThresholdDays: number;
  /** Automatic rotation or alert only */
  autoRotate: boolean;
  /** Webhook for rotation events */
  webhookUrl?: string;
}

class CertificateManager {
  private config: CertificateRotationConfig;
  private currentCert: Certificate;

  async checkAndRotate(): Promise<void> {
    const daysUntilExpiry = this.getDaysUntilExpiry(this.currentCert);

    if (daysUntilExpiry <= this.config.renewalThresholdDays) {
      if (this.config.autoRotate) {
        await this.rotateCertificate();
      } else {
        await this.sendAlert(daysUntilExpiry);
      }
    }
  }

  private async rotateCertificate(): Promise<void> {
    // Request new certificate from CA/ACME
    const newCert = await this.requestNewCertificate();

    // Graceful reload
    await this.reloadTlsContext(newCert);

    this.currentCert = newCert;

    // Notify via webhook
    if (this.config.webhookUrl) {
      await this.notifyRotation(newCert);
    }
  }
}
```

---

## 8. Security Testing

### 8.1 Penetration Testing Checklist

| Category | Test | Expected Result |
|----------|------|-----------------|
| **Authentication** | | |
| | Invalid API key | 401 Unauthorized |
| | Expired JWT | 401 Unauthorized |
| | Invalid mTLS cert | Connection refused |
| | Missing auth header | 401 Unauthorized |
| **Authorization** | | |
| | Access without required role | 403 Forbidden |
| | Policy bypass attempt | Denied |
| | Privilege escalation | Denied |
| | Cross-tenant access | Denied |
| **Input Validation** | | |
| | Malformed JSON | 400 Bad Request |
| | Oversized request | 413 Payload Too Large |
| | SQL injection in attributes | No SQL executed |
| | CEL injection attempt | Safe evaluation |
| **Rate Limiting** | | |
| | Excessive requests | 429 Too Many Requests |
| | Burst protection | Requests queued/rejected |

### 8.2 OWASP Considerations

| OWASP Top 10 | Risk | Mitigation |
|--------------|------|------------|
| A01 Broken Access Control | Unauthorized access | Policy enforcement, audit logging |
| A02 Cryptographic Failures | Data exposure | TLS 1.3, AES-256-GCM |
| A03 Injection | CEL injection | Sandboxed CEL evaluation |
| A04 Insecure Design | Design flaws | Threat modeling, security reviews |
| A05 Security Misconfiguration | Defaults | Secure defaults, validation |
| A07 Auth Failures | Credential theft | mTLS, JWT validation, key rotation |
| A09 Logging Failures | Missing audit | Comprehensive audit logging |

### 8.3 CEL Injection Prevention

```typescript
class SecureCelEvaluator {
  private readonly allowedFunctions: Set<string>;
  private readonly maxExpressionLength: number;
  private readonly maxEvaluationTime: number;

  constructor(config: CelSecurityConfig) {
    this.allowedFunctions = new Set(config.allowedFunctions);
    this.maxExpressionLength = config.maxExpressionLength ?? 1000;
    this.maxEvaluationTime = config.maxEvaluationTimeMs ?? 100;
  }

  async evaluate(
    expression: string,
    context: EvaluationContext
  ): Promise<boolean> {
    // Length check
    if (expression.length > this.maxExpressionLength) {
      throw new CelSecurityError('Expression exceeds maximum length');
    }

    // Parse and validate AST
    const ast = this.parse(expression);
    this.validateAst(ast);

    // Evaluate with timeout
    return this.evaluateWithTimeout(ast, context);
  }

  private validateAst(ast: CelAst): void {
    // Check for disallowed functions
    const usedFunctions = this.extractFunctions(ast);
    for (const fn of usedFunctions) {
      if (!this.allowedFunctions.has(fn)) {
        throw new CelSecurityError(`Function not allowed: ${fn}`);
      }
    }

    // Check for infinite loops (no loops in CEL, but check recursion depth)
    const depth = this.calculateDepth(ast);
    if (depth > 10) {
      throw new CelSecurityError('Expression too deeply nested');
    }
  }

  private async evaluateWithTimeout(
    ast: CelAst,
    context: EvaluationContext
  ): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.maxEvaluationTime
    );

    try {
      return await Promise.race([
        this.doEvaluate(ast, context),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new CelSecurityError('Evaluation timeout'));
          });
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

---

## 9. Compliance Reporting

### 9.1 Report Generation

```typescript
class ComplianceReporter {
  async generateReport(
    framework: ComplianceFramework,
    period: { start: Date; end: Date }
  ): Promise<ComplianceReport> {
    const controls = await this.assessControls(framework, period);
    const overallStatus = this.calculateOverallStatus(controls);

    return {
      framework,
      controls,
      overallStatus,
      generatedAt: new Date(),
      assessmentPeriod: period,
    };
  }

  private async assessControls(
    framework: ComplianceFramework,
    period: { start: Date; end: Date }
  ): Promise<ControlAssessment[]> {
    const controlDefinitions = FRAMEWORK_CONTROLS[framework];
    const assessments: ControlAssessment[] = [];

    for (const control of controlDefinitions) {
      const evidence = await this.gatherEvidence(control, period);
      const gaps = this.identifyGaps(control, evidence);

      assessments.push({
        controlId: control.id,
        controlName: control.name,
        status: gaps.length === 0 ? 'implemented' :
                evidence.length > 0 ? 'partial' : 'not-implemented',
        evidence,
        gaps,
        lastAssessed: new Date(),
      });
    }

    return assessments;
  }
}
```

---

## 10. Performance Requirements

| Metric | Target |
|--------|--------|
| Audit log write latency | < 1ms (async) |
| PII masking overhead | < 0.1ms |
| Decision explanation | < 10ms |
| Compliance report generation | < 30s |
| Certificate rotation | Zero downtime |

---

## 11. Related Documents

- [OBSERVABILITY-SDD.md](./OBSERVABILITY-SDD.md) - Metrics, tracing, logging
- [SERVER-PACKAGE-SDD.md](./SERVER-PACKAGE-SDD.md) - Server implementation
- [MULTI-TENANCY-SDD.md](./MULTI-TENANCY-SDD.md) - Tenant isolation
- [JWT-AUXDATA-SDD.md](./JWT-AUXDATA-SDD.md) - JWT handling

---

## 12. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-11-23 | Initial specification |
